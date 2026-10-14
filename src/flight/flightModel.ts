import {
  airDensity,
  EARTH_MU_M3S2,
  EARTH_RADIUS_M,
  G0_MS2,
  pressureRatio,
} from '../simulation/constants';
import type { StageParams } from '../simulation/ascent/flightVehicle';
import { add, dot, len, localFrame, scale, type Vec2 } from './orbitMath';
import {
  bodyFrame,
  convertPitch,
  gravityAccel,
  MOON_N,
  MOON_SURFACE_SPEED_MS,
  referenceBody,
  selenoAngle,
  surfaceState,
  type GravityEnv,
  type ReferenceBody,
} from '../moon/moonOrbit';

/*
 * Orbital flight and re-entry model for the ship (planar, Earth-centred, no Earth rotation).
 * Attitude is a pitch angle in the orbital plane measured from the local horizon toward "up"
 * (0 = horizontal prograde, 90 = nose up, 180 = horizontal retrograde) plus a bank angle about
 * the nose that rotates aerodynamic lift out of the plane. Gameplay model, not engineering data.
 */

export interface ShipSpec {
  readonly stage: StageParams;
  /** 0..1 share of ship sections covered by heat-shield tiles. */
  readonly shieldCoverage: number;
  /** Flaps are needed to hold a belly-first attitude in the atmosphere. */
  readonly hasFlaps: boolean;
  readonly lengthM: number;
  readonly radiusM: number;
  /** A docking adapter on the nose (needed to dock with the station). */
  readonly hasDockingAdapter?: boolean;
}

/** 'tipped': down on the Moon but fallen over (ship lost, crew assumed rescued). */
export type FlightPhase = 'flight' | 'landed' | 'splashdown' | 'crashed' | 'destroyed' | 'tipped';

export interface FlightEvent {
  readonly tS: number;
  readonly kind: 'info' | 'warn' | 'fail' | 'success';
  readonly text: string;
}

export interface FlightState {
  readonly tS: number;
  readonly r: Vec2;
  readonly v: Vec2;
  readonly propKg: number;
  /** Nose direction above the local horizon (deg, prograde-referenced). */
  readonly pitchDeg: number;
  /** Bank about the nose (deg); 0 = lift "up" in the orbital plane. */
  readonly bankDeg: number;
  /** Visual-only yaw (out-of-plane steering is not simulated). */
  readonly yawDeg: number;
  readonly throttle: number;
  readonly enginesOut: number;
  /** 0..1 hull and heat-shield condition. */
  readonly hull: number;
  readonly shield: number;
  readonly heatFluxWm2: number;
  readonly peakHeatFluxWm2: number;
  readonly gLoad: number;
  readonly peakG: number;
  readonly angleOfAttackDeg: number;
  readonly phase: FlightPhase;
  readonly events: readonly FlightEvent[];
  /** Contact metrics, set when the ship comes down. */
  readonly touchdown?: TouchdownResult;
  /** Body the attitude (pitch) and telemetry refer to; absent = Earth. */
  readonly ref?: ReferenceBody;
  /** Landing thrusters running (final lunar descent). */
  readonly landingThrusters?: boolean;
}

/** Model constants (gameplay values). */
export const FLIGHT = {
  /** Heat absorbed per m² before the tiles are used up (scaled by coverage). */
  shieldCapacityJm2: 2.2e9,
  /** Heat per m² bare steel tolerates before structural failure. */
  steelCapacityJm2: 1.2e8,
  /** Belly-first (windward tiles) needs this much angle of attack. */
  minBellyAoaDeg: 35,
  /** Without flaps the ship cannot hold more than this angle of attack. */
  noFlapsMaxAoaDeg: 20,
  liftToDragAtBelly: 0.32,
  noseCd: 0.45,
  sideCd: 1.15,
  touchdownMaxVertMS: 6,
  touchdownMaxHorizMS: 4,
  touchdownMaxTiltDeg: 15,
  splashMaxVertMS: 25,
  crewGWarning: 5,
  /** Engine governor: thrust never exceeds this acceleration (engines shut down as needed). */
  maxThrustG: 3.5,
  minThrottlePerEngine: 0.4,
  /**
   * Below this height above the Moon the main engines hand over to high-mounted landing
   * thrusters with fine throttle (main engines can't throttle low enough to hover in lunar gravity).
   */
  landingThrusterAltM: 3_000,
  /** Landing-thruster acceleration at full throttle (m/s², about 2.5 lunar g). */
  landingThrusterAccelMS2: 4,
  lunarTouchdownMaxVertMS: 3,
  lunarTouchdownMaxHorizMS: 2,
  /** Tilt plus terrain slope beyond this tips the ship over. */
  lunarMaxLeanDeg: 12,
  lunarHardMaxVertMS: 8,
} as const;

/** Sutton–Graves stagnation heating (W/m²) with a ~4.5 m nose radius. */
export function heatFlux(densityKgM3: number, speedMS: number): number {
  return 1.7415e-4 * Math.sqrt(densityKgM3 / 4.5) * speedMS * speedMS * speedMS;
}

export function shipMassKg(spec: ShipSpec, propKg: number): number {
  return spec.stage.dryMassKg + propKg;
}

/** Nose unit vector from pitch in the local frame (`frameUp` overrides Earth's vertical). */
export function noseDirection(r: Vec2, pitchDeg: number, frameUp?: Vec2): Vec2 {
  const up = frameUp ?? localFrame(r).up;
  const east: Vec2 = [up[1], -up[0]];
  const p = (pitchDeg * Math.PI) / 180;
  return add(scale(east, Math.cos(p)), scale(up, Math.sin(p)));
}

/**
 * Flight path angle (deg) relative to the ship's reference body. Near the Moon it uses the
 * velocity over the (slowly turning) lunar surface, which is what matters for landing.
 */
export function relativeFlightPathDeg(s: FlightState, env?: GravityEnv | null): number {
  const f = bodyFrame(s.ref ?? 'earth', s.r, s.v, s.tS, env);
  const spin = f.body === 'moon' ? MOON_N * Math.hypot(f.r[0], f.r[1]) : 0;
  return (Math.atan2(dot(f.v, f.up), dot(f.v, f.east) - spin) * 180) / Math.PI;
}

/** Flight path angle (deg): direction of the velocity above the local horizon. */
export function flightPathAngleDeg(r: Vec2, v: Vec2): number {
  const f = localFrame(r);
  return (Math.atan2(dot(v, f.up), dot(v, f.east)) * 180) / Math.PI;
}

export function initialFlightState(r: Vec2, v: Vec2, propKg: number, tS = 0): FlightState {
  return {
    tS,
    r,
    v,
    propKg,
    pitchDeg: flightPathAngleDeg(r, v),
    bankDeg: 0,
    yawDeg: 0,
    throttle: 0,
    enginesOut: 0,
    hull: 1,
    shield: 1,
    heatFluxWm2: 0,
    peakHeatFluxWm2: 0,
    gLoad: 0,
    peakG: 0,
    angleOfAttackDeg: 0,
    phase: 'flight',
    events: [],
  };
}

export interface FlightControls {
  /** Desired pitch (the model slews toward it at `slewDegS`). */
  readonly targetPitchDeg: number;
  readonly bankDeg: number;
  readonly yawDeg: number;
  readonly throttle: number;
  readonly slewDegS: number;
}

export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Advances the ship by one fixed step. Pure. `env` adds the Moon (lunar missions). */
export function stepFlight(
  s0: FlightState,
  spec: ShipSpec,
  c: FlightControls,
  dt: number,
  env?: GravityEnv | null,
): FlightState {
  if (s0.phase !== 'flight') return s0;
  const events: FlightEvent[] = [];
  const t = s0.tS + dt;
  const f = localFrame(s0.r);
  const alt = f.altitudeM;
  const speed = len(s0.v);
  // Attitude refers to the Moon inside its sphere of influence; switching keeps the nose fixed.
  const ref: ReferenceBody = referenceBody(s0.r, s0.tS, env);
  let s = s0;
  let targetPitchDeg = c.targetPitchDeg;
  if (ref !== (s0.ref ?? 'earth')) {
    const from = bodyFrame(s0.ref ?? 'earth', s0.r, s0.v, s0.tS, env);
    const to = bodyFrame(ref, s0.r, s0.v, s0.tS, env);
    s = { ...s0, pitchDeg: wrap180(convertPitch(s0.pitchDeg, from.upAngle, to.upAngle)), ref };
    targetPitchDeg = convertPitch(c.targetPitchDeg, from.upAngle, to.upAngle);
    events.push({
      tS: t,
      kind: 'info',
      text:
        ref === 'moon'
          ? "Entered the Moon's sphere of influence."
          : "Left the Moon's sphere of influence.",
    });
  }
  const rf = ref === 'earth' ? null : bodyFrame(ref, s.r, s.v, s.tS, env);
  const gamma = rf
    ? (Math.atan2(dot(rf.v, rf.up), dot(rf.v, rf.east)) * 180) / Math.PI
    : flightPathAngleDeg(s.r, s.v);

  // Attitude slew (limited by RCS/flap authority).
  const delta = wrap180(targetPitchDeg - s.pitchDeg);
  const maxStep = c.slewDegS * dt;
  let pitchDeg = wrap180(s.pitchDeg + Math.max(-maxStep, Math.min(maxStep, delta)));
  // Without flaps the ship can't hold a high angle of attack in thick air: it weathervanes.
  const rho = airDensity(alt);
  let aoa = wrap180(pitchDeg - gamma);
  if (!spec.hasFlaps && rho > 1e-5 && Math.abs(aoa) > FLIGHT.noFlapsMaxAoaDeg) {
    aoa = Math.sign(aoa) * FLIGHT.noFlapsMaxAoaDeg;
    pitchDeg = wrap180(gamma + aoa);
  }

  // Engines.
  const mass = shipMassKg(spec, s.propKg);
  const running = Math.max(0, spec.stage.engineCount - s.enginesOut);
  const vacFrac = 1 - pressureRatio(alt);
  const perEngine =
    spec.stage.thrustSlPerEngineN +
    (spec.stage.thrustVacPerEngineN - spec.stage.thrustSlPerEngineN) * vacFrac;
  const isp = spec.stage.ispSlS + (spec.stage.ispVacS - spec.stage.ispSlS) * vacFrac;
  const landingThrusters = !!rf && rf.altitudeM < FLIGHT.landingThrusterAltM && s.propKg > 0;
  let throttle = s.propKg > 0 && running > 0 ? Math.max(0, Math.min(1, c.throttle)) : 0;
  let thrustN: number;
  if (landingThrusters) {
    throttle = s.propKg > 0 ? Math.max(0, Math.min(1, c.throttle)) : 0;
    thrustN = throttle * FLIGHT.landingThrusterAccelMS2 * mass;
  } else {
    if (throttle > 0) {
      const full = running * perEngine;
      const cap = (FLIGHT.maxThrustG * G0_MS2 * mass) / full;
      throttle = Math.max(FLIGHT.minThrottlePerEngine / running, Math.min(throttle, cap));
    }
    thrustN = running * perEngine * throttle;
  }
  const burned = Math.min(s.propKg, isp > 0 ? (thrustN / (isp * G0_MS2)) * dt : 0);
  const nose = noseDirection(s.r, pitchDeg, rf?.up);
  const aThrust = scale(nose, thrustN / mass);

  // Aerodynamics: drag area blends nose-on and side-on; lift peaks at mid angles.
  let aAero: Vec2 = [0, 0];
  let flux = 0;
  if (rho > 1e-9 && speed > 1) {
    const q = 0.5 * rho * speed * speed;
    const aoaRad = (aoa * Math.PI) / 180;
    const endArea = Math.PI * spec.radiusM * spec.radiusM;
    const sideArea = spec.lengthM * spec.radiusM * 2;
    const cdA =
      FLIGHT.noseCd * endArea * Math.cos(aoaRad) ** 2 +
      FLIGHT.sideCd * sideArea * Math.sin(aoaRad) ** 2;
    const drag = (q * cdA) / mass;
    const vHat = scale(s.v, 1 / speed);
    const liftMag =
      drag * FLIGHT.liftToDragAtBelly * Math.sin(2 * Math.abs(aoaRad)) * Math.sign(aoaRad || 1);
    // In-plane "up" normal to the velocity; bank tilts lift out of the plane (lost in 2D).
    const liftDir: Vec2 = [-vHat[1], vHat[0]];
    const towardUp = dot(liftDir, f.up) >= 0 ? liftDir : scale(liftDir, -1);
    const inPlaneLift = liftMag * Math.cos((c.bankDeg * Math.PI) / 180);
    aAero = add(scale(vHat, -drag), scale(towardUp, inPlaneLift));
    flux = heatFlux(rho, speed);
  }

  const rMag = len(s.r);
  const aGrav = env
    ? gravityAccel(s.r, s.tS, env)
    : scale(s.r, -EARTH_MU_M3S2 / (rMag * rMag * rMag));
  const aTotal = add(add(aGrav, aThrust), aAero);
  const v = add(s.v, scale(aTotal, dt));
  const r = add(s.r, scale(v, dt));
  const gLoad = len(add(aThrust, aAero)) / G0_MS2;

  // Heating: tiles take the load when the belly faces the flow; otherwise (or through gaps) steel does.
  let shield = s.shield;
  let hull = s.hull;
  if (flux > 0) {
    const bellyOn = Math.abs(aoa) >= FLIGHT.minBellyAoaDeg;
    const tileShare = bellyOn ? spec.shieldCoverage : 0;
    const heat = flux * dt;
    if (shield > 0)
      shield = Math.max(
        0,
        shield -
          (heat * tileShare) / (FLIGHT.shieldCapacityJm2 * Math.max(0.05, spec.shieldCoverage)),
      );
    const steelShare = 1 - tileShare + (shield <= 0 ? tileShare : 0);
    hull = Math.max(0, hull - (heat * steelShare) / FLIGHT.steelCapacityJm2);
    if (s.shield > 0.25 && shield <= 0.25)
      events.push({ tS: t, kind: 'warn', text: 'Heat shield below 25%.' });
    if (s.hull > 0.5 && hull <= 0.5)
      events.push({ tS: t, kind: 'warn', text: 'Hull overheating: structural damage.' });
  }
  if (s.peakG < FLIGHT.crewGWarning && gLoad >= FLIGHT.crewGWarning) {
    events.push({ tS: t, kind: 'warn', text: `High g-load (${gLoad.toFixed(1)} g) on the crew.` });
  }

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
    ...(ref === 'moon' ? { ref } : s.ref ? { ref } : {}),
    landingThrusters: landingThrusters && throttle > 0,
  };
  if (s.propKg > 0 && next.propKg <= 0)
    events.push({ tS: t, kind: 'warn', text: 'Ship propellant depleted.' });

  if (hull <= 0) {
    events.push({ tS: t, kind: 'fail', text: 'Ship broke up from re-entry heating.' });
    next = { ...next, phase: 'destroyed', throttle: 0 };
  } else if (len(r) <= EARTH_RADIUS_M) {
    next = touchdown(next, s, events, t);
  } else if (
    rf &&
    env &&
    bodyFrame('moon', r, v, t, env).altitudeM <=
      (env.terrain?.heightAt(selenoAngle(r, t, env.moon)) ?? 0)
  ) {
    next = lunarTouchdown(next, s, events, t, env);
  }
  return events.length ? { ...next, events: [...s.events, ...events] } : next;
}

export interface TouchdownResult {
  readonly vertMS: number;
  readonly horizMS: number;
  readonly tiltDeg: number;
  /** Set for touchdowns on the Moon. */
  readonly body?: 'moon';
  readonly slopeDeg?: number;
  /** Selenographic angle of the touchdown point (radians). */
  readonly seleno?: number;
}

export function touchdownMetrics(r: Vec2, v: Vec2, pitchDeg: number): TouchdownResult {
  const f = localFrame(r);
  return {
    vertMS: -dot(v, f.up),
    horizMS: Math.abs(dot(v, f.east)),
    tiltDeg: Math.abs(90 - pitchDeg),
  };
}

/** Surface contact: decides between a landing, a splashdown and a crash. Water is decided later by zone. */
function touchdown(
  next: FlightState,
  prev: FlightState,
  events: FlightEvent[],
  t: number,
): FlightState {
  const m = touchdownMetrics(prev.r, next.v, next.pitchDeg);
  const surface = scale(next.r, EARTH_RADIUS_M / len(next.r));
  const gentle =
    m.vertMS <= FLIGHT.touchdownMaxVertMS &&
    m.horizMS <= FLIGHT.touchdownMaxHorizMS &&
    m.tiltDeg <= FLIGHT.touchdownMaxTiltDeg;
  const soft = m.vertMS <= FLIGHT.splashMaxVertMS && m.horizMS <= 40;
  const phase: FlightPhase = gentle ? 'landed' : soft ? 'splashdown' : 'crashed';
  events.push({
    tS: t,
    kind: phase === 'crashed' ? 'fail' : 'success',
    text:
      phase === 'landed'
        ? `Touchdown at ${m.vertMS.toFixed(1)} m/s.`
        : phase === 'splashdown'
          ? `Hard contact at ${m.vertMS.toFixed(1)} m/s vertical, ${m.horizMS.toFixed(0)} m/s horizontal.`
          : `Impact at ${m.vertMS.toFixed(0)} m/s.`,
  });
  return { ...next, r: surface, v: [0, 0], throttle: 0, phase, touchdown: m };
}

/** Contact with the lunar surface: a landing, a hard landing (damage), a tip-over or a crash. */
function lunarTouchdown(
  next: FlightState,
  prev: FlightState,
  events: FlightEvent[],
  t: number,
  env: GravityEnv,
): FlightState {
  const fr = bodyFrame('moon', prev.r, next.v, prev.tS, env);
  const vertMS = -dot(fr.v, fr.up);
  // Horizontal speed over the (slowly turning) ground.
  const horizMS = Math.abs(dot(fr.v, fr.east) - MOON_SURFACE_SPEED_MS);
  const seleno = selenoAngle(next.r, t, env.moon);
  const slopeDeg = env.terrain?.slopeAt(seleno) ?? 0;
  const tiltDeg = Math.abs(wrap180(90 - next.pitchDeg));
  const lean = tiltDeg + slopeDeg;
  const m: TouchdownResult = { vertMS, horizMS, tiltDeg, body: 'moon', slopeDeg, seleno };
  const ground = surfaceState(seleno, t, env.moon, env.terrain?.heightAt(seleno) ?? 0);
  const rest = { r: ground.r, v: ground.v, throttle: 0, touchdown: m, landingThrusters: false };
  if (vertMS > FLIGHT.lunarHardMaxVertMS || horizMS > 6) {
    events.push({ tS: t, kind: 'fail', text: `Impact on the Moon at ${vertMS.toFixed(0)} m/s.` });
    return { ...next, ...rest, phase: 'crashed' };
  }
  if (lean > FLIGHT.lunarMaxLeanDeg || horizMS > FLIGHT.lunarTouchdownMaxHorizMS) {
    events.push({
      tS: t,
      kind: 'fail',
      text: `The ship tipped over (${lean.toFixed(0)}° lean on a ${slopeDeg.toFixed(0)}° slope, ${horizMS.toFixed(1)} m/s sideways).`,
    });
    return { ...next, ...rest, phase: 'tipped' };
  }
  const hard = vertMS > FLIGHT.lunarTouchdownMaxVertMS;
  const hull = hard
    ? Math.max(0.05, next.hull - (vertMS - FLIGHT.lunarTouchdownMaxVertMS) * 0.08)
    : next.hull;
  events.push({
    tS: t,
    kind: hard ? 'warn' : 'success',
    text: hard
      ? `Hard lunar touchdown at ${vertMS.toFixed(1)} m/s: landing legs damaged.`
      : `Lunar touchdown at ${vertMS.toFixed(1)} m/s.`,
  });
  return { ...next, ...rest, hull, phase: 'landed' };
}

/** Δv left in the ship (ideal rocket equation, vacuum Isp). */
export function deltaVRemaining(spec: ShipSpec, propKg: number): number {
  const m0 = shipMassKg(spec, propKg);
  const mf = spec.stage.dryMassKg;
  return spec.stage.ispVacS > 0 && m0 > mf ? spec.stage.ispVacS * G0_MS2 * Math.log(m0 / mf) : 0;
}
