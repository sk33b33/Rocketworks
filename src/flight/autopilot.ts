import { airDensity, EARTH_RADIUS_M, G0_MS2 } from '../simulation/constants';
import {
  FLIGHT,
  flightPathAngleDeg,
  stepFlight,
  wrap180,
  type FlightControls,
  type FlightState,
  type ShipSpec,
} from './flightModel';
import type { LandingZone } from './landingZones';
import { len, localFrame, orbitalElements, visVivaSpeed, wrapAngle, type Vec2 } from './orbitMath';

/*
 * Assisted flight: attitude holds plus four programs (circularize, deorbit, re-entry, landing).
 * Each call returns the controls to apply this step. Guidance laws are simple and tuned for the
 * game; the player can take over at any time.
 */

export type AttitudeMode =
  'manual' | 'prograde' | 'retrograde' | 'radial-out' | 'radial-in' | 'belly' | 'vertical';

export type ProgramId = 'none' | 'circularize' | 'rendezvous' | 'deorbit' | 'reentry' | 'landing';

export const BELLY_AOA_DEG = 65;
export const DEORBIT_PERIAPSIS_M = 30_000;
export const CIRCULAR_TARGET_PE_M = 140_000;
/** Attitude slew rates (deg/s): RCS in vacuum, flaps help in the air. */
export const SLEW_VACUUM = 8;
export const SLEW_AERO = 20;

export function attitudeTarget(mode: AttitudeMode, s: FlightState, manualPitch: number): number {
  const gamma = flightPathAngleDeg(s.r, s.v);
  switch (mode) {
    case 'prograde':
      return gamma;
    case 'retrograde':
      return gamma + 180;
    case 'radial-out':
      return 90;
    case 'radial-in':
      return -90;
    case 'belly':
      return gamma + BELLY_AOA_DEG;
    case 'vertical':
      return 90;
    default:
      return manualPitch;
  }
}

export function slewRate(s: FlightState): number {
  return airDensity(localFrame(s.r).altitudeM) > 1e-4 ? SLEW_AERO : SLEW_VACUUM;
}

export interface ProgramState {
  readonly program: ProgramId;
  /** Program-specific progress flags. */
  readonly burning: boolean;
  /** Ground angle at which to start the deorbit burn (null until planned). */
  readonly deorbitBurnAngle: number | null;
  readonly flipped: boolean;
  readonly lastPredictionT: number;
  readonly predictedImpactAngle: number | null;
  /** Re-entry bank currently commanded by guidance. */
  readonly bankDeg?: number;
  readonly lastEccentricity?: number;
}

export const IDLE_PROGRAM: ProgramState = {
  program: 'none',
  burning: false,
  deorbitBurnAngle: null,
  flipped: false,
  lastPredictionT: -Infinity,
  predictedImpactAngle: null,
};

export interface ProgramOutput {
  readonly mode: AttitudeMode;
  readonly controls: Omit<FlightControls, 'slewDegS' | 'yawDeg'>;
  readonly next: ProgramState;
  readonly message?: string;
}

/** Δv for a retrograde burn that lowers periapsis to `targetPeM` from the current radius. */
export function deorbitDeltaV(s: FlightState, targetPeM = DEORBIT_PERIAPSIS_M): number {
  const r = len(s.r);
  const want = visVivaSpeed(r, r, EARTH_RADIUS_M + targetPeM);
  return Math.max(0, len(s.v) - want);
}

/** Nominal re-entry bank used for planning, leaving guidance margin to stretch or shorten. */
export const PLANNING_BANK_DEG = 45;
/** Deorbit aim point beyond the zone, trimmed out by re-entry guidance. */
export const DEORBIT_AIM_LONG_M = 25_000;

/**
 * Predicts how far (unwrapped ground angle, radians) the ship travels before coming down if it
 * did an impulsive retrograde burn of `burnDvMS` now and then flew belly-first with the given
 * bank. Coarse steps for speed. Returns null if it doesn't come down within `maxS`.
 */
export function predictImpactTravel(
  s: FlightState,
  spec: ShipSpec,
  burnDvMS: number,
  bankDeg = PLANNING_BANK_DEG,
  maxS = 9_000,
): number | null {
  const speed = len(s.v);
  const vHat: Vec2 = speed > 0 ? [s.v[0] / speed, s.v[1] / speed] : [0, 0];
  let state: FlightState = {
    ...s,
    v: [s.v[0] - vHat[0] * burnDvMS, s.v[1] - vHat[1] * burnDvMS],
    events: [],
    phase: 'flight',
  };
  const t0 = s.tS;
  // Light heat model is irrelevant for the prediction: use an indestructible copy.
  const ghost: ShipSpec = { ...spec, shieldCoverage: 1, hasFlaps: true };
  let travel = 0;
  let last = localFrame(state.r).groundAngle;
  while (state.tS - t0 < maxS) {
    const alt = localFrame(state.r).altitudeM;
    const dt = alt > 130_000 ? 2 : alt > 40_000 ? 0.5 : 0.25;
    state = stepFlight(
      { ...state, hull: 1, shield: 1 },
      ghost,
      {
        targetPitchDeg: flightPathAngleDeg(state.r, state.v) + BELLY_AOA_DEG,
        bankDeg,
        yawDeg: 0,
        throttle: 0,
        slewDegS: 90,
      },
      dt,
    );
    const a = localFrame(state.r).groundAngle;
    travel += wrapAngle(a - last);
    last = a;
    if (state.phase !== 'flight') return travel;
  }
  return null;
}

/** Runs the active program for one step. */
export function runProgram(
  ps: ProgramState,
  s: FlightState,
  spec: ShipSpec,
  zone: LandingZone,
): ProgramOutput {
  const f = localFrame(s.r);
  const el = orbitalElements(s.r, s.v);
  const idle = (mode: AttitudeMode, message?: string): ProgramOutput => ({
    mode,
    controls: { targetPitchDeg: 0, bankDeg: 0, throttle: 0 },
    next: IDLE_PROGRAM,
    ...(message ? { message } : {}),
  });

  switch (ps.program) {
    case 'circularize': {
      // Stop at the eccentricity minimum (the most circular orbit this burn can reach).
      const rising =
        ps.burning &&
        ps.lastEccentricity !== undefined &&
        el.eccentricity > ps.lastEccentricity + 1e-6;
      if (
        el.status === 'orbit' &&
        el.periapsisAltM >= CIRCULAR_TARGET_PE_M &&
        (rising || el.eccentricity < 0.002)
      ) {
        return idle('prograde', 'Orbit circularized.');
      }
      // Burn prograde around apoapsis (vertical speed near zero, descending side allowed).
      const nearApo = Math.abs(el.verticalSpeedMS) < 25 || f.altitudeM >= el.apoapsisAltM - 2_000;
      const burning = ps.burning || nearApo;
      return {
        mode: 'prograde',
        controls: {
          targetPitchDeg: flightPathAngleDeg(s.r, s.v),
          bankDeg: 0,
          throttle: burning ? 1 : 0,
        },
        next: { ...ps, burning, lastEccentricity: el.eccentricity },
      };
    }
    case 'deorbit': {
      const dv = deorbitDeltaV(s);
      if (ps.burning) {
        if (el.periapsisAltM <= DEORBIT_PERIAPSIS_M) {
          return {
            mode: 'belly',
            controls: {
              targetPitchDeg: flightPathAngleDeg(s.r, s.v) + 90,
              bankDeg: 0,
              throttle: 0,
            },
            next: { ...IDLE_PROGRAM, program: 'reentry' },
            message: 'Deorbit burn complete. Re-entry guidance engaged.',
          };
        }
        return {
          mode: 'retrograde',
          controls: { targetPitchDeg: flightPathAngleDeg(s.r, s.v) + 180, bankDeg: 0, throttle: 1 },
          next: ps,
        };
      }
      // Plan once (and refresh occasionally): where would we land if we burned right now?
      let next = ps;
      const approaching =
        ps.deorbitBurnAngle !== null &&
        Math.abs(wrapAngle(f.groundAngle - ps.deorbitBurnAngle)) < 0.4;
      if (ps.deorbitBurnAngle === null || s.tS - ps.lastPredictionT > (approaching ? 15 : 600)) {
        const travel = predictImpactTravel(s, spec, dv);
        if (travel !== null) {
          // Aim a little long: re-entry banking can always shorten the range, never stretch it much.
          const aimLong = DEORBIT_AIM_LONG_M / EARTH_RADIUS_M;
          next = {
            ...ps,
            deorbitBurnAngle: wrapAngle(zone.groundAngle + aimLong - travel),
            lastPredictionT: s.tS,
          };
        }
      }
      const burnAngle = next.deorbitBurnAngle;
      // Burn when the ship crosses the planned point (accounting for the burn duration).
      const err = burnAngle === null ? Infinity : wrapAngle(f.groundAngle - burnAngle);
      const start = err >= 0 && err < 0.05;
      return {
        mode: 'retrograde',
        controls: {
          targetPitchDeg: flightPathAngleDeg(s.r, s.v) + 180,
          bankDeg: 0,
          throttle: start ? 1 : 0,
        },
        next: { ...next, burning: start },
        ...(start ? { message: 'Deorbit burn started.' } : {}),
      };
    }
    case 'reentry': {
      if (f.altitudeM < 14_000) {
        return {
          mode: 'belly',
          controls: {
            targetPitchDeg: flightPathAngleDeg(s.r, s.v) + BELLY_AOA_DEG,
            bankDeg: 0,
            throttle: 0,
          },
          next: { ...IDLE_PROGRAM, program: 'landing' },
          message: 'Subsonic. Landing program engaged.',
        };
      }
      // Range control: refresh the impact prediction every 20 s and bank away lift if long.
      let next = ps;
      if (s.tS - ps.lastPredictionT > 15) {
        // Always predict at the nominal bank; the command below corrects around it.
        const travel = predictImpactTravel(s, spec, 0, PLANNING_BANK_DEG, 4_000);
        next = {
          ...ps,
          predictedImpactAngle: travel === null ? null : wrapAngle(f.groundAngle + travel),
          lastPredictionT: s.tS,
        };
      }
      const overshootKm =
        next.predictedImpactAngle === null
          ? 0
          : (wrapAngle(next.predictedImpactAngle - zone.groundAngle) * EARTH_RADIUS_M) / 1000;
      // More bank = less in-plane lift = shorter range. Proportional to the predicted miss.
      const bank = Math.max(0, Math.min(88, PLANNING_BANK_DEG + overshootKm * 4));
      next = { ...next, bankDeg: bank };
      return {
        mode: 'belly',
        controls: {
          targetPitchDeg: flightPathAngleDeg(s.r, s.v) + BELLY_AOA_DEG,
          bankDeg: bank,
          throttle: 0,
        },
        next,
      };
    }
    case 'landing': {
      const alt = Math.max(0.5, f.altitudeM);
      const vV = el.verticalSpeedMS;
      const vH = el.horizontalSpeedMS;
      const mass = spec.stage.dryMassKg + s.propKg;
      const running = Math.max(1, spec.stage.engineCount - s.enginesOut);
      const fullThrust = running * spec.stage.thrustSlPerEngineN;
      const thrustMax = Math.min(fullThrust, FLIGHT.maxThrustG * G0_MS2 * mass);
      const aAvail = thrustMax / mass - G0_MS2;
      // Deceleration needed to stop exactly at the ground (suicide-burn law).
      const aReq = vV < 0 ? (vV * vV) / (2 * alt) : 0;
      const flipTimeS = 110 / SLEW_AERO + 1.5;
      const flipAlt = (vV * vV) / (2 * 0.6 * aAvail) + Math.abs(vV) * flipTimeS + 100;
      const flipped = ps.flipped || alt <= flipAlt;
      if (!flipped) {
        return {
          mode: 'belly',
          controls: {
            targetPitchDeg: flightPathAngleDeg(s.r, s.v) + BELLY_AOA_DEG,
            bankDeg: 0,
            throttle: 0,
          },
          next: ps,
        };
      }
      const tilt = Math.max(-12, Math.min(12, -vH * 0.5));
      const upright = Math.abs(wrap180(90 - s.pitchDeg)) < 25;
      const burning = ps.burning || aReq >= 0.6 * aAvail;
      let accelCmd = 0;
      if (burning) {
        accelCmd = alt < 25 ? G0_MS2 + 2 * (-1.5 - vV) : G0_MS2 + aReq * 1.1;
      }
      let thr = upright && burning ? Math.max(0, Math.min(1, (accelCmd * mass) / fullThrust)) : 0;
      // A light ship can't throttle below one engine at minimum: pulse it instead of hovering.
      const minThrust = FLIGHT.minThrottlePerEngine * spec.stage.thrustSlPerEngineN;
      if (thr > 0 && thr * fullThrust < minThrust)
        thr = thr * fullThrust >= minThrust * 0.85 ? minThrust / fullThrust : 0;
      return {
        mode: 'vertical',
        controls: { targetPitchDeg: 90 - tilt, bankDeg: 0, throttle: thr },
        next: { ...ps, flipped: true, burning },
      };
    }
    default:
      return idle('manual');
  }
}
