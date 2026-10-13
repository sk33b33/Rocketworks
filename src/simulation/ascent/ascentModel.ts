import {
  airDensity,
  circularSpeed,
  EARTH_MU_M3S2,
  EARTH_RADIUS_M,
  G0_MS2,
  pressureRatio,
} from '../constants';
import type { FlightVehicle, StageParams } from './flightVehicle';

/*
 * Simplified 2D ascent model (downrange × altitude over a spherical Earth, no rotation).
 * Gravity includes "centrifugal relief" from horizontal speed so that orbit happens naturally
 * at circular speed. Integration is semi-implicit Euler at a fixed step. Gameplay model only.
 */

export type AscentTarget =
  | { readonly kind: 'orbit'; readonly altitudeM: number }
  | { readonly kind: 'suborbital'; readonly secoSpeedMS: number; readonly minApogeeM: number };

export type FailureKind = 'booster-engine-out' | 'ship-engine-out' | 'vehicle-loss';

export interface ScheduledFailure {
  readonly atS: number;
  readonly kind: FailureKind;
}

export interface AscentConfig {
  readonly vehicle: FlightVehicle;
  readonly target: AscentTarget;
  readonly failures: readonly ScheduledFailure[];
}

export type AscentStatus =
  | 'flying'
  | 'coasting'
  | 'orbit'
  | 'apogee'
  | 'low-apogee'
  | 'no-liftoff'
  | 'out-of-propellant'
  | 'crashed'
  | 'lost'
  | 'aborted';

export interface FlightEvent {
  readonly tS: number;
  readonly kind: 'info' | 'warn' | 'fail' | 'success';
  readonly text: string;
}

export interface BallisticBody {
  readonly downrangeM: number;
  readonly altitudeM: number;
  readonly vHorizMS: number;
  readonly vVertMS: number;
  readonly landed: boolean;
}

export interface AscentState {
  readonly tS: number;
  readonly downrangeM: number;
  readonly altitudeM: number;
  readonly vHorizMS: number;
  readonly vVertMS: number;
  readonly stage: 'booster' | 'ship';
  readonly boosterPropKg: number;
  readonly shipPropKg: number;
  readonly boosterEnginesOut: number;
  readonly shipEnginesOut: number;
  readonly enginesOn: boolean;
  readonly throttle: number;
  /** Thrust direction above the local horizon, degrees (90 = straight up). */
  readonly elevationDeg: number;
  readonly dynamicPressurePa: number;
  readonly accelerationG: number;
  readonly maxQPa: number;
  readonly maxQPassed: boolean;
  readonly maxAltitudeM: number;
  readonly maxSpeedMS: number;
  readonly booster: BallisticBody | null;
  readonly status: AscentStatus;
  readonly events: readonly FlightEvent[];
  readonly firedFailures: number;
}

/** Throttle limits and guidance tuning (gameplay values). */
export const GUIDANCE = {
  maxQThrottlePa: 32_000,
  maxQThrottle: 0.72,
  boosterMaxAccelG: 4,
  shipMaxAccelG: 3.5,
  minThrottle: 0.4,
  verticalRiseM: 400,
  pitchProgramHeightM: 95_000,
  pitchProgramExponent: 0.5,
  minBoosterElevationDeg: 22,
  maxTimeS: 1_200,
} as const;

export function initialAscentState(vehicle: FlightVehicle): AscentState {
  return {
    tS: 0,
    downrangeM: 0,
    altitudeM: 0,
    vHorizMS: 0,
    vVertMS: 0,
    stage: 'booster',
    boosterPropKg: vehicle.booster.propellantKg,
    shipPropKg: vehicle.ship.propellantKg,
    boosterEnginesOut: 0,
    shipEnginesOut: 0,
    enginesOn: true,
    throttle: 1,
    elevationDeg: 90,
    dynamicPressurePa: 0,
    accelerationG: 0,
    maxQPa: 0,
    maxQPassed: false,
    maxAltitudeM: 0,
    maxSpeedMS: 0,
    booster: null,
    status: 'flying',
    events: [],
    firedFailures: 0,
  };
}

export function isTerminal(status: AscentStatus): boolean {
  return status !== 'flying' && status !== 'coasting';
}

export function isSuccess(status: AscentStatus): boolean {
  return status === 'orbit' || status === 'apogee';
}

/** Net downward acceleration: gravity minus centrifugal relief from horizontal speed. */
export function effectiveGravity(altitudeM: number, vHorizMS: number): number {
  const r = EARTH_RADIUS_M + altitudeM;
  return EARTH_MU_M3S2 / (r * r) - (vHorizMS * vHorizMS) / r;
}

/** Thrust (N) and specific impulse (s) of a stage's running engines at an altitude. */
export function stagePerformance(
  stage: StageParams,
  enginesOut: number,
  altitudeM: number,
  throttle: number,
) {
  const running = Math.max(0, stage.engineCount - enginesOut);
  const vacFrac = 1 - pressureRatio(altitudeM);
  const perEngine =
    stage.thrustSlPerEngineN + (stage.thrustVacPerEngineN - stage.thrustSlPerEngineN) * vacFrac;
  const ispS = stage.ispSlS + (stage.ispVacS - stage.ispSlS) * vacFrac;
  return { thrustN: running * perEngine * throttle, ispS, running };
}

/** Ballistic apogee estimate from current state (vertical motion under effective gravity). */
export function estimateApogee(altitudeM: number, vVertMS: number, vHorizMS: number): number {
  const g = Math.max(0.5, effectiveGravity(altitudeM, vHorizMS));
  return vVertMS > 0 ? altitudeM + (vVertMS * vVertMS) / (2 * g) : altitudeM;
}

function stepBallistic(
  body: BallisticBody,
  dt: number,
  massKg: number,
  v: FlightVehicle,
): BallisticBody {
  if (body.landed) return body;
  const speed = Math.hypot(body.vHorizMS, body.vVertMS);
  const drag =
    speed > 0
      ? (0.5 *
          airDensity(body.altitudeM) *
          speed *
          speed *
          v.dragCoefficient *
          1.6 *
          v.referenceAreaM2) /
        massKg
      : 0;
  const g = effectiveGravity(body.altitudeM, body.vHorizMS);
  const vH = body.vHorizMS - (speed > 0 ? (drag * body.vHorizMS) / speed : 0) * dt;
  const vV = body.vVertMS - (g + (speed > 0 ? (drag * body.vVertMS) / speed : 0)) * dt;
  const altitudeM = body.altitudeM + vV * dt;
  if (altitudeM <= 0)
    return { downrangeM: body.downrangeM, altitudeM: 0, vHorizMS: 0, vVertMS: 0, landed: true };
  return {
    downrangeM: body.downrangeM + vH * dt,
    altitudeM,
    vHorizMS: vH,
    vVertMS: vV,
    landed: false,
  };
}

/** Thrust elevation for the current phase (booster open-loop program, ship closed-loop hold). */
function guidanceElevationDeg(
  s: AscentState,
  target: AscentTarget,
  accelAvailable: number,
): number {
  if (s.stage === 'booster') {
    if (s.altitudeM < GUIDANCE.verticalRiseM) return 90;
    const frac = Math.min(1, (s.altitudeM - GUIDANCE.verticalRiseM) / GUIDANCE.pitchProgramHeightM);
    const fromVertical = 90 * Math.pow(frac, GUIDANCE.pitchProgramExponent);
    return Math.max(GUIDANCE.minBoosterElevationDeg, 90 - fromVertical);
  }
  // Ship: steer the vertical speed toward a target that converges on the desired altitude.
  const targetAlt = target.kind === 'orbit' ? target.altitudeM : 160_000;
  const desiredVv = Math.max(-150, Math.min(450, (targetAlt - s.altitudeM) / 70));
  const g = effectiveGravity(s.altitudeM, s.vHorizMS);
  const needed = g + 0.06 * (desiredVv - s.vVertMS) * G0_MS2;
  const sinE = accelAvailable > 0 ? Math.max(-0.35, Math.min(0.85, needed / accelAvailable)) : 0;
  return (Math.asin(sinE) * 180) / Math.PI;
}

/** Advances the ascent by one fixed step. Pure: returns a new state. */
export function stepAscent(s: AscentState, config: AscentConfig, dt: number): AscentState {
  if (isTerminal(s.status)) return s;
  const v = config.vehicle;
  const events: FlightEvent[] = [];
  const t = s.tS + dt;
  let next = { ...s, tS: t };

  // Scheduled random failures.
  let fired = s.firedFailures;
  while (fired < config.failures.length && config.failures[fired]!.atS <= t) {
    const f = config.failures[fired]!;
    fired += 1;
    if (f.kind === 'booster-engine-out' && next.stage === 'booster' && next.enginesOn) {
      next = { ...next, boosterEnginesOut: next.boosterEnginesOut + 1 };
      events.push({
        tS: t,
        kind: 'warn',
        text: 'Booster engine-out: remaining engines compensate.',
      });
    } else if (f.kind === 'ship-engine-out' && next.stage === 'ship' && next.enginesOn) {
      next = { ...next, shipEnginesOut: next.shipEnginesOut + 1 };
      events.push({
        tS: t,
        kind: 'warn',
        text: 'Ship engine-out: continuing on remaining engines.',
      });
    } else if (f.kind === 'vehicle-loss' && next.enginesOn) {
      events.push({ tS: t, kind: 'fail', text: 'Anomaly: loss of vehicle. Flight termination.' });
      return finish({ ...next, firedFailures: fired, status: 'lost', enginesOn: false }, events, s);
    }
  }
  next = { ...next, firedFailures: fired };

  const stageParams = next.stage === 'booster' ? v.booster : v.ship;
  const enginesOut = next.stage === 'booster' ? next.boosterEnginesOut : next.shipEnginesOut;
  const shipMass = v.ship.dryMassKg + next.shipPropKg;
  const massKg =
    next.stage === 'booster' ? v.booster.dryMassKg + next.boosterPropKg + shipMass : shipMass;
  const propKg = next.stage === 'booster' ? next.boosterPropKg : next.shipPropKg;

  // Throttle law: max-Q bucket and acceleration limit.
  const speed = Math.hypot(next.vHorizMS, next.vVertMS);
  const q = 0.5 * airDensity(next.altitudeM) * speed * speed;
  const full = stagePerformance(stageParams, enginesOut, next.altitudeM, 1);
  let throttle = next.enginesOn && propKg > 0 ? 1 : 0;
  if (throttle > 0) {
    if (next.stage === 'booster' && q > GUIDANCE.maxQThrottlePa && !next.maxQPassed)
      throttle = GUIDANCE.maxQThrottle;
    const maxG = next.stage === 'booster' ? GUIDANCE.boosterMaxAccelG : GUIDANCE.shipMaxAccelG;
    if (full.thrustN > 0) throttle = Math.min(throttle, (maxG * G0_MS2 * massKg) / full.thrustN);
    // Engines can be shut down individually, so the floor is one engine at minimum throttle.
    throttle = Math.max(GUIDANCE.minThrottle / Math.max(1, full.running), throttle);
  }
  const perf = stagePerformance(stageParams, enginesOut, next.altitudeM, throttle);
  const thrustN = next.enginesOn && propKg > 0 ? perf.thrustN : 0;

  // Hold-down check at T-0: the clamps only release if thrust exceeds weight.
  if (s.tS === 0 && thrustN <= massKg * G0_MS2) {
    events.push({
      tS: 0,
      kind: 'fail',
      text: `Hold-down abort: thrust ${(thrustN / 1e6).toFixed(1)} MN is below vehicle weight ${((massKg * G0_MS2) / 1e6).toFixed(1)} MN.`,
    });
    return finish(
      { ...next, tS: 0, status: 'no-liftoff', enginesOn: false, throttle: 0 },
      events,
      s,
    );
  }

  const elevationDeg =
    thrustN > 0 ? guidanceElevationDeg(next, config.target, thrustN / massKg) : next.elevationDeg;
  const e = (elevationDeg * Math.PI) / 180;
  const drag = speed > 0 ? (q * v.dragCoefficient * v.referenceAreaM2) / massKg : 0;
  const g = effectiveGravity(next.altitudeM, next.vHorizMS);
  const aThrust = thrustN / massKg;
  const aH = aThrust * Math.cos(e) - (speed > 0 ? (drag * next.vHorizMS) / speed : 0);
  const aV = aThrust * Math.sin(e) - (speed > 0 ? (drag * next.vVertMS) / speed : 0) - g;
  const vHorizMS = next.vHorizMS + aH * dt;
  const vVertMS = next.altitudeM <= 0 && aV < 0 && s.tS === 0 ? 0 : next.vVertMS + aV * dt;
  const altitudeM = next.altitudeM + vVertMS * dt;
  const downrangeM =
    next.downrangeM + vHorizMS * dt * (EARTH_RADIUS_M / (EARTH_RADIUS_M + Math.max(0, altitudeM)));

  // Propellant consumption.
  const mdot = thrustN > 0 && perf.ispS > 0 ? thrustN / (perf.ispS * G0_MS2) : 0;
  const burned = Math.min(propKg, mdot * dt);
  const boosterPropKg = next.stage === 'booster' ? next.boosterPropKg - burned : next.boosterPropKg;
  const shipPropKg = next.stage === 'ship' ? next.shipPropKg - burned : next.shipPropKg;

  const newSpeed = Math.hypot(vHorizMS, vVertMS);
  let state: AscentState = {
    ...next,
    downrangeM,
    altitudeM,
    vHorizMS,
    vVertMS,
    boosterPropKg,
    shipPropKg,
    throttle: thrustN > 0 ? throttle : 0,
    elevationDeg,
    dynamicPressurePa: q,
    accelerationG: Math.hypot(aH, aV + g) / G0_MS2,
    maxQPa: Math.max(next.maxQPa, q),
    maxAltitudeM: Math.max(next.maxAltitudeM, altitudeM),
    maxSpeedMS: Math.max(next.maxSpeedMS, newSpeed),
    booster: next.booster ? stepBallistic(next.booster, dt, v.booster.dryMassKg, v) : null,
  };

  // Milestone events.
  if (s.tS === 0) events.push({ tS: t, kind: 'info', text: 'Liftoff!' });
  if (s.altitudeM < 150 && altitudeM >= 150)
    events.push({ tS: t, kind: 'info', text: 'Tower cleared.' });
  if (!state.maxQPassed && state.maxQPa > 10_000 && q < state.maxQPa * 0.97) {
    state = { ...state, maxQPassed: true };
    events.push({
      tS: t,
      kind: 'info',
      text: `Max-Q passed (${(state.maxQPa / 1000).toFixed(1)} kPa).`,
    });
  }
  if (s.altitudeM < 100_000 && altitudeM >= 100_000)
    events.push({ tS: t, kind: 'info', text: 'Crossed 100 km: space.' });
  if (s.booster && !s.booster.landed && state.booster?.landed) {
    events.push({
      tS: t,
      kind: 'info',
      text: `Booster splashdown ${(state.booster.downrangeM / 1000).toFixed(0)} km downrange.`,
    });
  }

  // Staging: booster propellant exhausted -> hot staging.
  if (state.stage === 'booster' && state.boosterPropKg <= 0) {
    events.push({ tS: t, kind: 'info', text: 'MECO and hot staging: ship engines ignite.' });
    if (v.ship.engineCount === 0) {
      events.push({ tS: t, kind: 'fail', text: 'Ship has no engines: cannot continue.' });
      return finish(
        { ...state, stage: 'ship', status: 'out-of-propellant', enginesOn: false },
        events,
        s,
      );
    }
    state = {
      ...state,
      stage: 'ship',
      booster: {
        downrangeM: state.downrangeM,
        altitudeM: state.altitudeM,
        vHorizMS: state.vHorizMS,
        vVertMS: state.vVertMS,
        landed: false,
      },
    };
  }

  // Ship cutoff conditions.
  if (state.stage === 'ship' && state.enginesOn) {
    const tgt = config.target;
    const reachedOrbit =
      tgt.kind === 'orbit' &&
      state.altitudeM >= tgt.altitudeM * 0.9 &&
      state.vHorizMS >= circularSpeed(state.altitudeM);
    const reachedSuborbital = tgt.kind === 'suborbital' && state.vHorizMS >= tgt.secoSpeedMS;
    if (reachedOrbit) {
      events.push({
        tS: t,
        kind: 'success',
        text: `SECO. Orbit achieved at ${(state.altitudeM / 1000).toFixed(0)} km.`,
      });
      return finish({ ...state, enginesOn: false, throttle: 0, status: 'orbit' }, events, s);
    }
    if (reachedSuborbital) {
      events.push({
        tS: t,
        kind: 'info',
        text: 'SECO on the planned suborbital trajectory. Coasting to apogee.',
      });
      state = { ...state, enginesOn: false, throttle: 0, status: 'coasting' };
    } else if (state.shipPropKg <= 0) {
      const apogee = estimateApogee(state.altitudeM, state.vVertMS, state.vHorizMS);
      events.push({
        tS: t,
        kind: 'fail',
        text: `Ship propellant depleted at ${(state.altitudeM / 1000).toFixed(0)} km, ${Math.round(newSpeed)} m/s (projected apogee ${(apogee / 1000).toFixed(0)} km). Target not reached.`,
      });
      return finish(
        { ...state, enginesOn: false, throttle: 0, status: 'out-of-propellant' },
        events,
        s,
      );
    }
  }

  // Coast to apogee for suborbital profiles.
  if (state.status === 'coasting' && state.vVertMS <= 0) {
    const tgt = config.target;
    const ok = tgt.kind === 'suborbital' && state.maxAltitudeM >= tgt.minApogeeM;
    events.push(
      ok
        ? {
            tS: t,
            kind: 'success',
            text: `Apogee ${(state.maxAltitudeM / 1000).toFixed(0)} km reached. Test objectives met.`,
          }
        : {
            tS: t,
            kind: 'fail',
            text: `Apogee only ${(state.maxAltitudeM / 1000).toFixed(0)} km: below the planned profile.`,
          },
    );
    return finish({ ...state, status: ok ? 'apogee' : 'low-apogee' }, events, s);
  }

  if (s.tS > 0 && state.altitudeM < 0) {
    events.push({ tS: t, kind: 'fail', text: 'Vehicle impacted the ground.' });
    return finish(
      { ...state, altitudeM: 0, status: 'crashed', enginesOn: false, throttle: 0 },
      events,
      s,
    );
  }
  if (t >= GUIDANCE.maxTimeS) {
    events.push({
      tS: t,
      kind: 'fail',
      text: 'Flight time limit reached without meeting the target.',
    });
    return finish({ ...state, status: 'out-of-propellant', enginesOn: false }, events, s);
  }
  return finish(state, events, s);
}

function finish(state: AscentState, newEvents: FlightEvent[], prev: AscentState): AscentState {
  return newEvents.length ? { ...state, events: [...prev.events, ...newEvents] } : state;
}

/** Player- or system-commanded abort during ascent. */
export function abortAscent(s: AscentState, crewed: boolean): AscentState {
  if (isTerminal(s.status)) return s;
  const text = crewed
    ? 'ABORT: ship separates and flies its abort profile. Crew safe (simplified abort model).'
    : 'ABORT: flight terminated by the range.';
  return {
    ...s,
    status: 'aborted',
    enginesOn: false,
    throttle: 0,
    events: [...s.events, { tS: s.tS, kind: 'fail', text }],
  };
}

/** Runs the whole ascent headlessly (used by tests and for previews). */
export function simulateAscent(config: AscentConfig, dt: number, maxSteps = 100_000): AscentState {
  let s = initialAscentState(config.vehicle);
  for (let i = 0; i < maxSteps && !isTerminal(s.status); i++) s = stepAscent(s, config, dt);
  return s;
}
