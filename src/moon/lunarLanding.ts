import { G0_MS2 } from '../simulation/constants';
import { FLIGHT, type FlightState, type ShipSpec } from '../flight/flightModel';
import { dot, orbitalElements, wrapAngle, type Vec2 } from '../flight/orbitMath';
import {
  bodyFrame,
  MOON_MU_M3S2,
  MOON_N,
  MOON_RADIUS_M,
  moonState,
  type GravityEnv,
} from './moonOrbit';
import { MOON_BODY } from './lunarTransfer';
import type { LunarSite, SiteTerrain } from './lunarSites';

/*
 * Assisted lunar descent and ascent (gameplay guidance, not flight software).
 *
 * Descent: a small deorbit burn lowers the orbit's low point to ~15 km ahead of the site; the
 * braking burn lights when stopping at the "high gate" (3.5 km up and short of the target)
 * needs about 60% of the available thrust, and flies there with explicit (polynomial) guidance;
 * the approach steers to the flattest spot near the target (hazard avoidance) on the landing
 * thrusters; the terminal phase comes straight down at ~1.5 m/s. The player can take over at
 * any time; below 500 m that makes it a manual landing.
 *
 * Ascent: a short vertical rise, then thrust mostly horizontal while holding a climb profile,
 * cut off when the orbit's high point reaches ~95 km, and a circularization burn there.
 */

export const DESCENT_PERILUNE_M = 15_000;
/** High gate relative to the target: height above it, distance short of it, and the speeds there. */
export const HIGH_GATE = { heightM: 3_500, uprangeM: 3_500, vxMS: 40, vhMS: -25 } as const;
export const APPROACH_END_HEIGHT_M = 60;
/** The assist looks this far around the target for a flatter touchdown point. */
export const HAZARD_SEARCH_M = 400;
/** Below this height above the ground, flying without the program counts as a manual landing. */
export const MANUAL_LUNAR_ALT_M = 500;
export const ASCENT_ORBIT_M = 95_000;
const BRAKING_THRUST_SHARE = 0.6;

export type DescentPhase =
  'deorbit-wait' | 'deorbit' | 'coast' | 'braking' | 'approach' | 'terminal' | 'done';
export type AscentPhase = 'vertical' | 'climb' | 'coast' | 'circularize' | 'done';

export interface LandingGuidance {
  readonly kind: 'descent' | 'ascent';
  readonly descent: DescentPhase;
  readonly ascent: AscentPhase;
  /** Time to go of the current polynomial guidance leg (s). */
  readonly tgo: number;
  /** Along-track aim point relative to the site target (m). */
  readonly aimX: number;
  readonly aimSlopeDeg: number | null;
  readonly lastEccentricity?: number;
}

export const DESCENT_START: LandingGuidance = {
  kind: 'descent',
  descent: 'deorbit-wait',
  ascent: 'vertical',
  tgo: 0,
  aimX: 0,
  aimSlopeDeg: null,
};

export const ASCENT_START: LandingGuidance = {
  ...DESCENT_START,
  kind: 'ascent',
  ascent: 'vertical',
};

export const DESCENT_LABELS: Record<DescentPhase, string> = {
  'deorbit-wait': 'Waiting for the descent burn',
  deorbit: 'Descent orbit burn',
  coast: 'Coasting down to the braking point',
  braking: 'Braking burn',
  approach: 'Approach (hazard avoidance)',
  terminal: 'Terminal descent',
  done: 'Down',
};

export const ASCENT_LABELS: Record<AscentPhase, string> = {
  vertical: 'Vertical rise',
  climb: 'Climbing to orbit',
  coast: 'Coasting up',
  circularize: 'Circularizing',
  done: 'In lunar orbit',
};

export interface LandingOutput {
  readonly controls: { targetPitchDeg: number; bankDeg: number; throttle: number };
  readonly next: LandingGuidance;
  readonly message?: string;
  readonly done?: boolean;
}

/** Ship geometry relative to the landing site (2D: along-track x, height). */
export interface SiteGeometry {
  /** Along-track offset of the ship from the site target (m, negative = still uprange). */
  readonly x: number;
  /** Height above the Moon's mean radius (m). */
  readonly h: number;
  /** Height above the ground directly below. */
  readonly radarM: number;
  /** Speed over the ground (along-track, m/s) and vertical speed. */
  readonly vx: number;
  readonly vh: number;
  /** Gravity minus the centrifugal term of horizontal flight (m/s²). */
  readonly gEff: number;
  readonly up: Vec2;
  readonly east: Vec2;
}

export function siteGeometry(s: FlightState, env: GravityEnv, terrain: SiteTerrain): SiteGeometry {
  const f = bodyFrame('moon', s.r, s.v, s.tS, env);
  const r = Math.hypot(f.r[0], f.r[1]);
  const u = dot(f.v, f.east);
  const m = moonState(env.moon, s.tS);
  const toEarth = Math.atan2(-m.r[0], -m.r[1]);
  const seleno = wrapAngle(f.upAngle - toEarth);
  const x = terrain.offsetOf(seleno);
  const ground = Math.abs(x) < terrain.halfSpanM ? terrain.heightAt(x) : 0;
  return {
    x,
    h: f.altitudeM,
    radarM: f.altitudeM - ground,
    vx: u - MOON_N * r,
    vh: dot(f.v, f.up),
    gEff: MOON_MU_M3S2 / (r * r) - (u * u) / r,
    up: f.up,
    east: f.east,
  };
}

const pitchOf = (ax: number, ah: number) => (Math.atan2(ah, ax) * 180) / Math.PI;
const mainAccelMax = (spec: ShipSpec, s: FlightState) => {
  const mass = spec.stage.dryMassKg + s.propKg;
  const running = Math.max(1, spec.stage.engineCount - s.enginesOut);
  return (
    Math.min(running * spec.stage.thrustVacPerEngineN, FLIGHT.maxThrustG * G0_MS2 * mass) / mass
  );
};

/** Throttle for a commanded acceleration magnitude (main engines or landing thrusters). */
function throttleFor(a: number, spec: ShipSpec, s: FlightState, geo: SiteGeometry): number {
  if (geo.h < FLIGHT.landingThrusterAltM) return Math.min(1, a / FLIGHT.landingThrusterAccelMS2);
  const mass = spec.stage.dryMassKg + s.propKg;
  const running = Math.max(1, spec.stage.engineCount - s.enginesOut);
  return Math.min(1, (a * mass) / (running * spec.stage.thrustVacPerEngineN));
}

/** Explicit guidance: acceleration to reach (xf, hf) with (vxf, vhf) in `tgo` seconds. */
function eGuidance(
  geo: SiteGeometry,
  xf: number,
  hf: number,
  vxf: number,
  vhf: number,
  tgo: number,
): [number, number] {
  const t = Math.max(1, tgo);
  const ax = (6 * (xf - geo.x)) / (t * t) - (2 * (2 * geo.vx + vxf)) / t;
  const ah = (6 * (hf - geo.h)) / (t * t) - (2 * (2 * geo.vh + vhf)) / t + geo.gEff;
  return [ax, ah];
}

/** Inertial angle of the site around the Moon at time t (it turns with the Moon). */
function siteAngle(site: LunarSite, env: GravityEnv, tS: number): number {
  const m = moonState(env.moon, tS);
  return Math.atan2(-m.r[0], -m.r[1]) + site.seleno;
}

/** Runs the descent for one step. */
export function runDescent(
  g: LandingGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
  site: LunarSite,
  terrain: SiteTerrain,
  dt: number,
): LandingOutput {
  const f = bodyFrame('moon', s.r, s.v, s.tS, env);
  const el = orbitalElements(f.r, f.v, MOON_BODY);
  const geo = siteGeometry(s, env, terrain);
  const retroPitch = pitchOf(-dot(f.v, f.east), -dot(f.v, f.up));
  const hold = { targetPitchDeg: retroPitch, bankDeg: 0, throttle: 0 };
  const gateX = g.aimX - HIGH_GATE.uprangeM;
  const gateH = terrain.heightAt(g.aimX) + HIGH_GATE.heightM;

  switch (g.descent) {
    case 'deorbit-wait': {
      const r1 = Math.hypot(f.r[0], f.r[1]);
      const rp = MOON_RADIUS_M + DESCENT_PERILUNE_M;
      const a = (r1 + rp) / 2;
      const tTransfer = Math.PI * Math.sqrt(a ** 3 / MOON_MU_M3S2);
      const vp = Math.sqrt(MOON_MU_M3S2 * (2 / rp - 1 / a));
      const brake = (vp * vp) / (2 * BRAKING_THRUST_SHARE * mainAccelMax(spec, s));
      const lead = (brake + HIGH_GATE.uprangeM + 15_000) / MOON_RADIUS_M;
      const periTarget = siteAngle(site, env, s.tS + tTransfer) - lead;
      const err = wrapAngle(f.upAngle + Math.PI - periTarget);
      if (err >= 0 && err < 0.03) {
        return {
          controls: hold,
          next: { ...g, descent: 'deorbit', tgo: 0 },
          message: `Descent orbit burn: low point ${DESCENT_PERILUNE_M / 1000} km ahead of ${site.name}.`,
        };
      }
      // Time to the burn (for the warp limit): the angle still to go at the orbit's rate.
      const rate = Math.hypot(f.v[0], f.v[1]) / r1;
      const togo = (err < 0 ? -err : 2 * Math.PI - err) / rate;
      return { controls: hold, next: { ...g, tgo: togo } };
    }
    case 'deorbit': {
      if (el.periapsisAltM <= DESCENT_PERILUNE_M || s.propKg <= 0) {
        return {
          controls: hold,
          next: { ...g, descent: 'coast' },
          message: 'Descent orbit set. Coasting down to the braking point.',
        };
      }
      return { controls: { ...hold, throttle: aligned(s, retroPitch) ? 0.25 : 0 }, next: g };
    }
    case 'coast': {
      // Offsets wrap around the Moon: only brake once the gate is ahead and within reach.
      const dist = gateX - geo.x;
      if (dist < -20_000 || dist > 1_500_000) return { controls: hold, next: g };
      const need = dist > 0 ? (geo.vx ** 2 - HIGH_GATE.vxMS ** 2) / (2 * dist) : Infinity;
      if (need >= BRAKING_THRUST_SHARE * mainAccelMax(spec, s)) {
        const tgo = dist > 0 ? (2 * dist) / (geo.vx + HIGH_GATE.vxMS) : 30;
        return {
          controls: hold,
          next: { ...g, descent: 'braking', tgo },
          message: `Braking burn: ${Math.round(dist / 1000)} km to the high gate.`,
        };
      }
      return { controls: hold, next: g };
    }
    case 'braking': {
      const tgo = g.tgo - dt;
      if (tgo <= 1 || geo.h < gateH - 300) {
        const aim = terrain.safestNear(g.aimX, HAZARD_SEARCH_M);
        const dist = aim.x - geo.x;
        const tApproach = Math.max(35, Math.min(110, (2 * Math.abs(dist)) / Math.max(5, geo.vx)));
        return {
          controls: hold,
          next: {
            ...g,
            descent: 'approach',
            tgo: tApproach,
            aimX: aim.x,
            aimSlopeDeg: aim.slopeDeg,
          },
          message:
            Math.abs(aim.x - g.aimX) > 20
              ? `High gate. Hazard avoidance: retargeting ${Math.round(aim.x - g.aimX)} m to a ${aim.slopeDeg.toFixed(0)}° spot.`
              : `High gate. Target clear (${aim.slopeDeg.toFixed(0)}° slope).`,
        };
      }
      const [ax, ah] = eGuidance(geo, gateX, gateH, HIGH_GATE.vxMS, HIGH_GATE.vhMS, tgo);
      return steer(ax, ah, s, spec, geo, { ...g, tgo });
    }
    case 'approach': {
      const tgo = g.tgo - dt;
      const hf = terrain.heightAt(g.aimX) + APPROACH_END_HEIGHT_M;
      if (tgo <= 2 || geo.radarM < APPROACH_END_HEIGHT_M + 5) {
        return {
          controls: hold,
          next: { ...g, descent: 'terminal', tgo: 0 },
          message: 'Terminal descent.',
        };
      }
      const [ax, ah] = eGuidance(geo, g.aimX, hf, 0, -2.5, tgo);
      return steer(ax, ah, s, spec, geo, { ...g, tgo });
    }
    case 'terminal': {
      const vTarget = geo.radarM > 20 ? -2.5 : -1.2;
      const ax = Math.max(-1.2, Math.min(1.2, -geo.vx * 0.8 - (geo.x - g.aimX) * 0.04));
      const ah = geo.gEff + (vTarget - geo.vh) * 1.5;
      return steer(ax, ah, s, spec, geo, g, 10);
    }
    default:
      return { controls: hold, next: g, done: true };
  }
}

function aligned(s: FlightState, pitch: number, tol = 4): boolean {
  return Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180) < tol;
}

/** Points the thrust along (ax, ah) and sets the throttle; optional tilt limit from vertical. */
function steer(
  ax: number,
  ah: number,
  s: FlightState,
  spec: ShipSpec,
  geo: SiteGeometry,
  next: LandingGuidance,
  maxTiltDeg?: number,
): LandingOutput {
  let pitch = pitchOf(ax, ah);
  if (maxTiltDeg !== undefined) pitch = Math.max(90 - maxTiltDeg, Math.min(90 + maxTiltDeg, pitch));
  const a = Math.hypot(ax, ah);
  const off = Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180);
  const throttle = off > 25 ? 0 : throttleFor(a, spec, s, geo);
  return { controls: { targetPitchDeg: pitch, bankDeg: 0, throttle }, next };
}

/** Runs the ascent to lunar orbit for one step. */
export function runAscent(
  g: LandingGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
  terrain: SiteTerrain,
): LandingOutput {
  const f = bodyFrame('moon', s.r, s.v, s.tS, env);
  const el = orbitalElements(f.r, f.v, MOON_BODY);
  const geo = siteGeometry(s, env, terrain);
  const prograde = pitchOf(dot(f.v, f.east), dot(f.v, f.up));
  switch (g.ascent) {
    case 'vertical':
      if (geo.radarM > 250)
        return {
          controls: { targetPitchDeg: 90, bankDeg: 0, throttle: 1 },
          next: { ...g, ascent: 'climb' },
          message: 'Pitching over toward orbit.',
        };
      return { controls: { targetPitchDeg: 90, bankDeg: 0, throttle: 1 }, next: g };
    case 'climb': {
      if (el.apoapsisAltM >= ASCENT_ORBIT_M && el.status !== 'escape') {
        return {
          controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: 0 },
          next: { ...g, ascent: 'coast' },
          message: `Engine cutoff: coasting up to ${Math.round(el.apoapsisAltM / 1000)} km.`,
        };
      }
      // Hold a climb profile with the vertical part of the thrust; the rest builds speed.
      const vhRef = Math.max(0, Math.min(180, (ASCENT_ORBIT_M - geo.h) / 70));
      const aMax =
        geo.h < FLIGHT.landingThrusterAltM ? FLIGHT.landingThrusterAccelMS2 : mainAccelMax(spec, s);
      const ah = Math.max(-aMax * 0.5, Math.min(aMax * 0.95, geo.gEff + (vhRef - geo.vh) * 0.4));
      const ax = Math.sqrt(Math.max(0, aMax * aMax - ah * ah));
      return { controls: { targetPitchDeg: pitchOf(ax, ah), bankDeg: 0, throttle: 1 }, next: g };
    }
    case 'coast': {
      if (Math.abs(el.verticalSpeedMS) < 8 || geo.h >= el.apoapsisAltM - 500)
        return {
          controls: {
            targetPitchDeg: prograde,
            bankDeg: 0,
            throttle: aligned(s, prograde) ? 1 : 0,
          },
          next: { ...g, ascent: 'circularize' },
          message: 'Circularizing in lunar orbit.',
        };
      return { controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: 0 }, next: g };
    }
    case 'circularize': {
      const rising =
        g.lastEccentricity !== undefined && el.eccentricity > g.lastEccentricity + 1e-6;
      if (
        (el.status === 'orbit' &&
          el.periapsisAltM >= 60_000 &&
          (rising || el.eccentricity < 0.003)) ||
        s.propKg <= 0
      ) {
        return {
          controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: 0 },
          next: { ...g, ascent: 'done' },
          message:
            el.status === 'orbit'
              ? `Back in lunar orbit: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km.`
              : 'Ascent ended short of orbit.',
          done: true,
        };
      }
      return {
        controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: 0.5 },
        next: { ...g, lastEccentricity: el.eccentricity },
      };
    }
    default:
      return {
        controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: 0 },
        next: g,
        done: true,
      };
  }
}

// ---- surface operations ----

export interface SurfaceTask {
  readonly id: string;
  readonly label: string;
  readonly durationS: number;
}

export function surfaceTasks(site: LunarSite, cargo: boolean): SurfaceTask[] {
  return [
    { id: 'safing', label: 'Post-landing checks and safing', durationS: 1_800 },
    { id: 'survey', label: `Survey the ${site.name} landing area`, durationS: 2 * 3_600 },
    { id: 'samples', label: 'Collect geology samples', durationS: 3 * 3_600 },
    cargo
      ? {
          id: 'experiments',
          label: 'Unload and deploy the surface science package',
          durationS: 3 * 3_600,
        }
      : {
          id: 'experiments',
          label: 'Set up the seismometer and laser reflector',
          durationS: 2 * 3_600,
        },
  ];
}

/** 0..1 progress of each surface task after `elapsedS` on the surface (safing gates the rest). */
export function surfaceProgress(tasks: readonly SurfaceTask[], elapsedS: number): number[] {
  const gate = tasks.find((t) => t.id === 'safing')?.durationS ?? 0;
  return tasks.map((t) =>
    Math.max(
      0,
      Math.min(1, t.id === 'safing' ? elapsedS / t.durationS : (elapsedS - gate) / t.durationS),
    ),
  );
}

/** Rating limits for lunar touchdowns. */
export function lunarRatingLimits() {
  return {
    missM: 300,
    vertMS: FLIGHT.lunarTouchdownMaxVertMS,
    horizMS: FLIGHT.lunarTouchdownMaxHorizMS,
    tiltDeg: FLIGHT.lunarMaxLeanDeg,
  };
}
