import { G0_MS2 } from '../simulation/constants';
import { SLEW_AERO, SLEW_VACUUM } from '../flight/autopilot';
import {
  aeroAcceleration,
  applyHeating,
  FLIGHT,
  mainEngineThrust,
  shipMassKg,
  wrap180,
  type FlightControls,
  type FlightEvent,
  type FlightState,
  type ShipSpec,
  type TouchdownResult,
} from '../flight/flightModel';
import { add, dot, scale, wrapAngle, type Vec2 } from '../flight/orbitMath';
import type { SiteTerrain } from '../moon/lunarSites';
import type { MarsSite } from './marsSites';
import { marsDensity, marsPressureRatio, MARS_MU_M3S2, MARS_RADIUS_M } from './solarSystem';

/*
 * Flight near Mars (Mars-centred, planar, Mars's rotation not simulated): gravity, the thin CO₂
 * atmosphere, the same ship aerodynamics and heating as at Earth, the main engines, and contact
 * with the ground around the landing site. The engines may throttle one engine deeper than at
 * Earth (to 15%) so the ship can hover in Mars gravity — a gameplay allowance. Pure functions.
 */

export const MARS = {
  /** One engine can throttle down to this share of its thrust for the landing. */
  minThrottlePerEngine: 0.15,
  touchdownMaxVertMS: 3,
  touchdownMaxHorizMS: 2,
  /** Tilt plus slope beyond this tips the ship over. */
  maxLeanDeg: 12,
  hardMaxVertMS: 8,
} as const;

/** Where the ground is: the chosen site and its terrain, once its position is fixed. */
export interface MarsGround {
  readonly site: MarsSite;
  readonly terrain: SiteTerrain<MarsSite>;
  /** Mars-centred angle of the site target (atan2(x, y)), or null until fixed. */
  readonly siteAngle: number | null;
}

/** Along-track offset (m) of a Mars-centred angle from the site target. */
export function siteOffset(angle: number, g: MarsGround): number | null {
  return g.siteAngle === null ? null : wrapAngle(angle - g.siteAngle) * MARS_RADIUS_M;
}

/** Ground height above the datum at a Mars-centred angle. */
export function groundHeightAt(angle: number, g: MarsGround): number {
  const x = siteOffset(angle, g);
  if (x === null || Math.abs(x) >= g.terrain.halfSpanM) return g.site.elevationM;
  return g.site.elevationM + g.terrain.heightAt(x);
}

export function groundSlopeAt(angle: number, g: MarsGround): number {
  const x = siteOffset(angle, g);
  if (x === null || Math.abs(x) >= g.terrain.halfSpanM) return 3;
  return g.terrain.slopeAt(x);
}

export interface MarsFrame {
  readonly up: Vec2;
  readonly east: Vec2;
  readonly radius: number;
  /** Altitude above the datum. */
  readonly altitudeM: number;
  readonly angle: number;
}

export function marsFrame(r: Vec2): MarsFrame {
  const radius = Math.hypot(r[0], r[1]);
  const up: Vec2 = [r[0] / radius, r[1] / radius];
  return {
    up,
    east: [up[1], -up[0]],
    radius,
    altitudeM: radius - MARS_RADIUS_M,
    angle: Math.atan2(up[0], up[1]),
  };
}

/** Flight-path angle (deg) above the local horizon. */
export function marsFlightPathDeg(r: Vec2, v: Vec2): number {
  const f = marsFrame(r);
  return (Math.atan2(dot(v, f.up), dot(v, f.east)) * 180) / Math.PI;
}

export function marsSlewRate(s: FlightState): number {
  return marsDensity(marsFrame(s.r).altitudeM) > 1e-4 ? SLEW_AERO : SLEW_VACUUM;
}

/** Height above the ground below the ship. */
export function radarAltitude(s: FlightState, g: MarsGround): number {
  const f = marsFrame(s.r);
  return f.altitudeM - groundHeightAt(f.angle, g);
}

/** Maximum main-engine acceleration (governed) for the current mass. */
export function marsAccelMax(spec: ShipSpec, propKg: number, enginesOut = 0): number {
  const mass = shipMassKg(spec, propKg);
  const running = Math.max(1, spec.stage.engineCount - enginesOut);
  return (
    Math.min(running * spec.stage.thrustVacPerEngineN, FLIGHT.maxThrustG * G0_MS2 * mass) / mass
  );
}

/** Advances the ship by one fixed step near Mars (state Mars-centred). Pure. */
export function stepMarsFlight(
  s: FlightState,
  spec: ShipSpec,
  c: FlightControls,
  dt: number,
  ground: MarsGround,
): FlightState {
  if (s.phase !== 'flight') return s;
  const events: FlightEvent[] = [];
  const t = s.tS + dt;
  const f = marsFrame(s.r);
  const alt = f.altitudeM;
  const speed = Math.hypot(s.v[0], s.v[1]);
  const gamma = (Math.atan2(dot(s.v, f.up), dot(s.v, f.east)) * 180) / Math.PI;

  const delta = wrap180(c.targetPitchDeg - s.pitchDeg);
  const maxStep = c.slewDegS * dt;
  let pitchDeg = wrap180(s.pitchDeg + Math.max(-maxStep, Math.min(maxStep, delta)));
  const rho = marsDensity(alt);
  let aoa = wrap180(pitchDeg - gamma);
  if (!spec.hasFlaps && rho > 1e-5 && Math.abs(aoa) > FLIGHT.noFlapsMaxAoaDeg) {
    aoa = Math.sign(aoa) * FLIGHT.noFlapsMaxAoaDeg;
    pitchDeg = wrap180(gamma + aoa);
  }

  const mass = shipMassKg(spec, s.propKg);
  const running = Math.max(0, spec.stage.engineCount - s.enginesOut);
  const vacFrac = 1 - marsPressureRatio(alt);
  const perEngine =
    spec.stage.thrustSlPerEngineN +
    (spec.stage.thrustVacPerEngineN - spec.stage.thrustSlPerEngineN) * vacFrac;
  const isp = spec.stage.ispSlS + (spec.stage.ispVacS - spec.stage.ispSlS) * vacFrac;
  const { throttle, thrustN } = mainEngineThrust(
    s.propKg,
    running,
    perEngine,
    c.throttle,
    mass,
    MARS.minThrottlePerEngine,
  );
  const burned = Math.min(s.propKg, isp > 0 ? (thrustN / (isp * G0_MS2)) * dt : 0);
  const p = (pitchDeg * Math.PI) / 180;
  const nose = add(scale(f.east, Math.cos(p)), scale(f.up, Math.sin(p)));
  const aThrust = scale(nose, thrustN / mass);
  const { a: aAero, flux } = aeroAcceleration(spec, s.v, speed, rho, aoa, c.bankDeg, f.up, mass);
  const k = -MARS_MU_M3S2 / (f.radius * f.radius * f.radius);
  const aGrav: Vec2 = [k * s.r[0], k * s.r[1]];
  const v = add(s.v, scale(add(add(aGrav, aThrust), aAero), dt));
  const r = add(s.r, scale(v, dt));
  const gLoad = Math.hypot(aThrust[0] + aAero[0], aThrust[1] + aAero[1]) / G0_MS2;
  const { shield, hull } = applyHeating(s, spec, flux, aoa, dt, events, t);

  let next: FlightState = {
    ...s,
    tS: t,
    r,
    v,
    propKg: s.propKg - burned,
    pitchDeg,
    bankDeg: c.bankDeg,
    yawDeg: c.yawDeg,
    throttle,
    hull,
    shield,
    heatFluxWm2: flux,
    peakHeatFluxWm2: Math.max(s.peakHeatFluxWm2, flux),
    gLoad,
    peakG: Math.max(s.peakG, gLoad),
    angleOfAttackDeg: aoa,
  };
  if (s.propKg > 0 && next.propKg <= 0)
    events.push({ tS: t, kind: 'warn', text: 'Ship propellant depleted.' });
  if (hull <= 0) {
    events.push({ tS: t, kind: 'fail', text: 'Ship broke up during Mars entry.' });
    next = { ...next, phase: 'destroyed', throttle: 0 };
  } else {
    const nf = marsFrame(r);
    if (nf.altitudeM <= groundHeightAt(nf.angle, ground))
      next = marsTouchdown(next, s, events, t, ground);
  }
  return events.length ? { ...next, events: [...s.events, ...events] } : next;
}

/** Contact with the Martian surface: a landing, a hard landing, a tip-over or a crash. */
function marsTouchdown(
  next: FlightState,
  prev: FlightState,
  events: FlightEvent[],
  t: number,
  g: MarsGround,
): FlightState {
  const f = marsFrame(prev.r);
  const vertMS = -dot(next.v, f.up);
  const horizMS = Math.abs(dot(next.v, f.east));
  const angle = marsFrame(next.r).angle;
  const slopeDeg = groundSlopeAt(angle, g);
  const tiltDeg = Math.abs(wrap180(90 - next.pitchDeg));
  const lean = tiltDeg + slopeDeg;
  const offset = siteOffset(angle, g);
  const m: TouchdownResult = {
    vertMS,
    horizMS,
    tiltDeg,
    body: 'mars',
    slopeDeg,
    ...(offset !== null ? { siteOffsetM: offset } : {}),
  };
  const h = groundHeightAt(angle, g);
  const up: Vec2 = [Math.sin(angle), Math.cos(angle)];
  const rest = {
    r: scale(up, MARS_RADIUS_M + h) as Vec2,
    v: [0, 0] as Vec2,
    throttle: 0,
    touchdown: m,
  };
  if (vertMS > MARS.hardMaxVertMS || horizMS > 6) {
    events.push({ tS: t, kind: 'fail', text: `Impact on Mars at ${vertMS.toFixed(0)} m/s.` });
    return { ...next, ...rest, phase: 'crashed' };
  }
  if (lean > MARS.maxLeanDeg || horizMS > MARS.touchdownMaxHorizMS) {
    events.push({
      tS: t,
      kind: 'fail',
      text: `The ship tipped over (${lean.toFixed(0)}° lean on a ${slopeDeg.toFixed(0)}° slope, ${horizMS.toFixed(1)} m/s sideways).`,
    });
    return { ...next, ...rest, phase: 'tipped' };
  }
  const hard = vertMS > MARS.touchdownMaxVertMS;
  const hull = hard
    ? Math.max(0.05, next.hull - (vertMS - MARS.touchdownMaxVertMS) * 0.08)
    : next.hull;
  events.push({
    tS: t,
    kind: hard ? 'warn' : 'success',
    text: hard
      ? `Hard touchdown on Mars at ${vertMS.toFixed(1)} m/s: landing legs damaged.`
      : `Touchdown on Mars at ${vertMS.toFixed(1)} m/s.`,
  });
  return { ...next, ...rest, hull, phase: 'landed' };
}

/** Rating limits for Mars touchdowns. */
export function marsRatingLimits() {
  return {
    missM: 300,
    vertMS: MARS.touchdownMaxVertMS,
    horizMS: MARS.touchdownMaxHorizMS,
    tiltDeg: MARS.maxLeanDeg,
  };
}
