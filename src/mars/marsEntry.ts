import { dot, wrapAngle } from '../flight/orbitMath';
import type { FlightControls, FlightState, ShipSpec } from '../flight/flightModel';
import {
  groundHeightAt,
  marsAccelMax,
  marsFrame,
  marsSlewRate,
  siteOffset,
  stepMarsFlight,
  type MarsGround,
} from './marsModel';
import { MARS_MU_M3S2, MARS_RADIUS_M } from './solarSystem';

/*
 * Mars entry, descent and landing (gameplay guidance, not flight software).
 *
 * Entry: belly-first at a high angle of attack; the bank angle steers lift up (longer) or down
 * (shorter). Every few seconds a predictor flies the rest of the entry and the fall to the
 * landing-burn height with candidate banks and keeps the one whose predicted touchdown point is
 * the site (bisection).
 *
 * Landing: below ~600 m/s the ship falls belly-flat for maximum drag; when stopping at the
 * "gate" (above and short of the target) needs most of the engines' thrust, it flips tail-first
 * and lights the engines on explicit (polynomial) guidance; at the gate it steers to the flattest
 * spot nearby (hazard avoidance) and comes straight down at ~1.5 m/s. The player can take over
 * at any time; flying the last 500 m without the program makes it a manual landing.
 */

export const ENTRY_AOA_DEG = 70;
/** The belly-flop fall after entry: nearly flat to the flow for the most drag. */
export const FALL_AOA_DEG = 82;
/** Entry hands over to the landing program below this speed. */
export const FALL_SPEED_MS = 600;
/** Nominal bank the arrival is aimed for (room to steer both ways). */
export const NOMINAL_BANK_DEG = 45;
export const GATE = { heightM: 500, uprangeM: 150, vxMS: 8, vhMS: -20 } as const;
export const APPROACH_END_HEIGHT_M = 40;
export const HAZARD_SEARCH_M = 250;
/** Below this radar height, flying without the program counts as a manual landing. */
export const MANUAL_MARS_ALT_M = 500;
const IGNITION_SHARE = 0.75;
const PREDICT_DT_S = 0.5;
const PREDICT_EVERY_S = 4;

export type MarsDescentPhase =
  'entry' | 'fall' | 'flip' | 'braking' | 'approach' | 'terminal' | 'done';

export interface MarsLanding {
  readonly phase: MarsDescentPhase;
  readonly bankDeg: number;
  readonly predictedAt: number;
  /** Predicted touchdown offset from the site (m) at the current bank. */
  readonly predictedMissM: number | null;
  readonly tgo: number;
  readonly aimX: number;
  readonly aimSlopeDeg: number | null;
}

export const ENTRY_START: MarsLanding = {
  phase: 'entry',
  bankDeg: NOMINAL_BANK_DEG,
  predictedAt: -Infinity,
  predictedMissM: null,
  tgo: 0,
  aimX: 0,
  aimSlopeDeg: null,
};

export const MARS_DESCENT_LABELS: Record<MarsDescentPhase, string> = {
  entry: 'Atmospheric entry',
  fall: 'Belly-flop fall',
  flip: 'Flip to landing attitude',
  braking: 'Landing burn',
  approach: 'Approach (hazard avoidance)',
  terminal: 'Terminal descent',
  done: 'Down',
};

export interface MarsGeometry {
  /** Along-track offset from the site target (m; negative = still uprange), null if unfixed. */
  readonly x: number | null;
  readonly h: number;
  readonly radarM: number;
  readonly vx: number;
  readonly vh: number;
  readonly gEff: number;
  readonly speed: number;
  readonly gammaDeg: number;
}

export function marsGeometry(s: FlightState, g: MarsGround): MarsGeometry {
  const f = marsFrame(s.r);
  const vx = dot(s.v, f.east);
  const vh = dot(s.v, f.up);
  return {
    x: siteOffset(f.angle, g),
    h: f.altitudeM,
    radarM: f.altitudeM - groundHeightAt(f.angle, g),
    vx,
    vh,
    gEff: MARS_MU_M3S2 / (f.radius * f.radius) - (vx * vx) / f.radius,
    speed: Math.hypot(vx, vh),
    gammaDeg: (Math.atan2(vh, vx) * 180) / Math.PI,
  };
}

const pitchOf = (ax: number, ah: number) => (Math.atan2(ah, ax) * 180) / Math.PI;
const offBy = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Entry and fall attitude: belly-first at the phase's angle of attack. */
export function entryControls(s: FlightState, bankDeg: number, aoaDeg: number): FlightControls {
  const f = marsFrame(s.r);
  const gamma = (Math.atan2(dot(s.v, f.up), dot(s.v, f.east)) * 180) / Math.PI;
  return {
    targetPitchDeg: gamma + aoaDeg,
    bankDeg,
    yawDeg: 0,
    throttle: 0,
    slewDegS: marsSlewRate(s),
  };
}

/** The landing burn only starts below this speed (the air does the rest). */
export const MAX_BURN_SPEED_MS = 1_800;
/** Seconds before ignition at which the flip to tail-first starts. */
const FLIP_LEAD_S = 9;

/**
 * Landing-burn timing for a constant-thrust stop along the velocity at `A` m/s²: the burn time,
 * the height it needs (half the sink rate over the burn plus some gravity), and the time left
 * until it must start (negative = late). Shared by the guidance and its predictor.
 */
export function burnTiming(
  geo: MarsGeometry,
  gateH: number,
  A: number,
): { burnS: number; untilS: number; travelM: number } {
  const burnS = geo.speed / A;
  const sink = Math.max(0, -geo.vh);
  // The air does the hypersonic braking: no burn above this speed unless the ground is close.
  if (geo.speed > MAX_BURN_SPEED_MS && geo.radarM > 4_000)
    return { burnS, untilS: Infinity, travelM: (geo.vx * burnS) / 2 };
  const needed = (sink * burnS) / 2 + 0.25 * geo.gEff * burnS * burnS;
  const avail = geo.h - gateH;
  return {
    burnS,
    untilS: sink > 1 ? (avail - needed) / sink : avail > needed ? Infinity : 0,
    travelM: (geo.vx * burnS) / 2,
  };
}

/** A predicted entry: where it comes down, or that it skips out / comes in too steep. */
export type EntryPrediction =
  | { readonly kind: 'ok'; readonly angle: number }
  | { readonly kind: 'skip' }
  | { readonly kind: 'crash' };

/**
 * Predicts where the ship would come down (Mars-centred angle) flying the entry at `bankDeg` and
 * then the belly-flop fall to the landing-burn ignition, plus the burn's own travel.
 */
export function predictEntry(
  s0: FlightState,
  spec: ShipSpec,
  ground: MarsGround,
  bankDeg: number,
  maxS = 1_500,
): EntryPrediction {
  let s = s0;
  let falling = marsGeometry(s, ground).speed < FALL_SPEED_MS;
  const A = IGNITION_SHARE * marsAccelMax(spec, s0.propKg);
  for (let t = 0; t < maxS; t += PREDICT_DT_S) {
    const geo = marsGeometry(s, ground);
    if (!falling && geo.speed < FALL_SPEED_MS) falling = true;
    const timing = burnTiming(geo, geo.h - geo.radarM + GATE.heightM, A);
    if (timing.untilS <= 0)
      return geo.speed > MAX_BURN_SPEED_MS
        ? { kind: 'crash' }
        : { kind: 'ok', angle: marsFrame(s.r).angle + timing.travelM / MARS_RADIUS_M };
    const c = falling
      ? entryControls(s, 0, FALL_AOA_DEG)
      : entryControls(s, bankDeg, ENTRY_AOA_DEG);
    s = stepMarsFlight(s, spec, c, PREDICT_DT_S, ground);
    if (s.phase !== 'flight') return { kind: 'crash' };
    // Climbing back out of the atmosphere: a skip.
    if (marsFrame(s.r).altitudeM > 100_000 && dot(s.r, s.v) > 0) return { kind: 'skip' };
  }
  return { kind: 'skip' };
}

/** Touchdown angle predicted at a bank, or null if that entry skips out or crashes. */
export function predictTouchdownAngle(
  s0: FlightState,
  spec: ShipSpec,
  ground: MarsGround,
  bankDeg: number,
): number | null {
  const p = predictEntry(s0, spec, ground, bankDeg);
  return p.kind === 'ok' ? p.angle : null;
}

/** Bank that brings the predicted touchdown onto the site (bisection on lift up/down). */
function solveBank(
  s: FlightState,
  spec: ShipSpec,
  ground: MarsGround,
): { bankDeg: number; missM: number | null } {
  // Signed miss (m): a skip counts as long, a too-steep entry as short.
  const miss = (bank: number) => {
    const p = predictEntry(s, spec, ground, bank);
    if (p.kind === 'skip') return Infinity;
    if (p.kind === 'crash' || ground.siteAngle === null) return -Infinity;
    return wrapAngle(p.angle - ground.siteAngle) * MARS_RADIUS_M;
  };
  // Lift up (0°) flies farthest; lift down (180°) shortest.
  let lo = 0;
  let hi = 180;
  const mLo = miss(lo);
  if (mLo < 0) return { bankDeg: 0, missM: Number.isFinite(mLo) ? mLo : null };
  const mHi = miss(hi);
  if (mHi > 0) return { bankDeg: 180, missM: Number.isFinite(mHi) ? mHi : null };
  let best: { bankDeg: number; missM: number | null } = { bankDeg: NOMINAL_BANK_DEG, missM: null };
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const m = miss(mid);
    if (Number.isFinite(m)) best = { bankDeg: mid, missM: m };
    else best = { bankDeg: mid, missM: best.missM };
    if (m > 0) lo = mid;
    else hi = mid;
  }
  return best;
}

export interface DescentOutput {
  readonly controls: FlightControls;
  readonly next: MarsLanding;
  readonly message?: string;
  readonly done?: boolean;
}

/** Runs entry, descent and landing guidance for one step. */
export function runMarsDescent(
  g: MarsLanding,
  s: FlightState,
  spec: ShipSpec,
  ground: MarsGround,
  dt: number,
): DescentOutput {
  const geo = marsGeometry(s, ground);
  const aMax = marsAccelMax(spec, s.propKg, s.enginesOut);
  const A = IGNITION_SHARE * aMax;
  const target = ground.terrain;
  const aimGround =
    ground.site.elevationM + (Math.abs(g.aimX) < target.halfSpanM ? target.heightAt(g.aimX) : 0);
  const gateX = g.aimX - GATE.uprangeM * Math.sign(geo.vx || 1);
  const gateH = aimGround + GATE.heightM;
  const retro = pitchOf(-geo.vx, -geo.vh);
  const steer = (ax: number, ah: number, next: MarsLanding, maxTilt?: number): DescentOutput => {
    let pitch = pitchOf(ax, ah);
    if (maxTilt !== undefined) pitch = Math.max(90 - maxTilt, Math.min(90 + maxTilt, pitch));
    const a = Math.hypot(ax, ah);
    // Throttle is a share of the engines' full thrust (the model applies the 3.5 g governor).
    const mass = spec.stage.dryMassKg + s.propKg;
    const full =
      Math.max(1, spec.stage.engineCount - s.enginesOut) * spec.stage.thrustVacPerEngineN;
    const throttle = offBy(pitch, s.pitchDeg) > 25 ? 0 : Math.min(1, (a * mass) / full);
    return {
      controls: {
        targetPitchDeg: pitch,
        bankDeg: 0,
        yawDeg: 0,
        throttle,
        slewDegS: marsSlewRate(s),
      },
      next,
    };
  };
  const eGuidance = (xf: number, hf: number, vxf: number, vhf: number, tgo: number) => {
    const t = Math.max(1, tgo);
    const x = geo.x ?? 0;
    const ax = (6 * (xf - x)) / (t * t) - (2 * (2 * geo.vx + vxf)) / t;
    const ah = (6 * (hf - geo.h)) / (t * t) - (2 * (2 * geo.vh + vhf)) / t + geo.gEff;
    return [ax, ah] as const;
  };

  switch (g.phase) {
    case 'entry':
    case 'fall': {
      let next = g;
      if (g.phase === 'entry' && s.tS - g.predictedAt >= PREDICT_EVERY_S && geo.radarM < 130_000) {
        const sol = solveBank(s, spec, ground);
        next = { ...g, bankDeg: sol.bankDeg, predictedMissM: sol.missM, predictedAt: s.tS };
      }
      const timing = burnTiming(geo, gateH, A);
      if (timing.untilS <= FLIP_LEAD_S) {
        return {
          controls: { ...entryControls(s, 0, FALL_AOA_DEG), targetPitchDeg: retro },
          next: { ...next, phase: 'flip' },
          message: 'Flip: turning tail-first for the landing burn.',
        };
      }
      if (g.phase === 'entry' && geo.speed < FALL_SPEED_MS && geo.radarM < 60_000) {
        return {
          controls: entryControls(s, 0, FALL_AOA_DEG),
          next: { ...next, phase: 'fall' },
          message: 'Entry complete: belly-flop fall toward the site.',
        };
      }
      return g.phase === 'fall'
        ? { controls: entryControls(s, 0, FALL_AOA_DEG), next }
        : { controls: entryControls(s, next.bankDeg, ENTRY_AOA_DEG), next };
    }
    case 'flip': {
      const timing = burnTiming(geo, gateH, A);
      if (timing.untilS <= 0) {
        const tgo = timing.burnS;
        return {
          ...steer(...eGuidance(gateX, gateH, GATE.vxMS * Math.sign(geo.vx || 1), GATE.vhMS, tgo), {
            ...g,
            phase: 'braking',
            tgo,
          }),
          message: `Landing burn: ${Math.round(geo.radarM)} m above the ground at ${Math.round(geo.speed)} m/s.`,
        };
      }
      return {
        controls: {
          targetPitchDeg: retro,
          bankDeg: 0,
          yawDeg: 0,
          throttle: 0,
          slewDegS: marsSlewRate(s),
        },
        next: g,
      };
    }
    case 'braking': {
      const tgo = g.tgo - dt;
      if (tgo <= 1 || geo.h < gateH - 100) {
        const aim = target.safestNear(g.aimX, HAZARD_SEARCH_M);
        const x = geo.x ?? 0;
        const tApproach = Math.max(
          18,
          Math.min(45, (2 * Math.abs(aim.x - x)) / Math.max(4, Math.abs(geo.vx))),
        );
        return {
          ...steer(0, geo.gEff, {
            ...g,
            phase: 'approach',
            tgo: tApproach,
            aimX: aim.x,
            aimSlopeDeg: aim.slopeDeg,
          }),
          message:
            Math.abs(aim.x - g.aimX) > 15
              ? `Gate. Hazard avoidance: retargeting ${Math.round(aim.x - g.aimX)} m to a ${aim.slopeDeg.toFixed(0)}° spot.`
              : `Gate. Target clear (${aim.slopeDeg.toFixed(0)}° slope).`,
        };
      }
      const [ax, ah] = eGuidance(gateX, gateH, GATE.vxMS * Math.sign(geo.vx || 1), GATE.vhMS, tgo);
      return steer(ax, ah, { ...g, tgo });
    }
    case 'approach': {
      const tgo = g.tgo - dt;
      const hf = aimGround + APPROACH_END_HEIGHT_M;
      if (tgo <= 2 || geo.radarM < APPROACH_END_HEIGHT_M + 5) {
        return {
          ...steer(0, geo.gEff, { ...g, phase: 'terminal', tgo: 0 }),
          message: 'Terminal descent.',
        };
      }
      const [ax, ah] = eGuidance(g.aimX, hf, 0, -2, tgo);
      return steer(ax, ah, { ...g, tgo });
    }
    case 'terminal': {
      const x = geo.x ?? 0;
      const vTarget = geo.radarM > 15 ? -2 : -1.2;
      const ax = Math.max(-1.5, Math.min(1.5, -geo.vx * 0.8 - (x - g.aimX) * 0.04));
      const ah = geo.gEff + (vTarget - geo.vh) * 1.5;
      return steer(ax, ah, g, 10);
    }
    default:
      return {
        controls: {
          targetPitchDeg: 90,
          bankDeg: 0,
          yawDeg: 0,
          throttle: 0,
          slewDegS: marsSlewRate(s),
        },
        next: g,
        done: true,
      };
  }
}

/**
 * Fixes where the site lies (the timed-arrival abstraction): the touchdown point of the nominal
 * entry from state `s` (above the atmosphere, Mars-centred). Falls back to other banks if the
 * nominal entry would skip out or come in too steep; null if none works.
 */
export function lockSiteAngle(
  s: FlightState,
  spec: ShipSpec,
  ground: Omit<MarsGround, 'siteAngle'>,
): number | null {
  const free: MarsGround = { ...ground, siteAngle: null };
  for (const bank of [NOMINAL_BANK_DEG, 30, 60, 15, 75, 0, 90, 120]) {
    const a = predictTouchdownAngle(s, spec, free, bank);
    if (a !== null) return a;
  }
  return null;
}
