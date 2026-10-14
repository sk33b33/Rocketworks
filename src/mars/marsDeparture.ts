import { EARTH_MU_M3S2 } from '../simulation/constants';
import {
  flightPathAngleDeg,
  stepFlight,
  type FlightControls,
  type FlightState,
  type ShipSpec,
} from '../flight/flightModel';
import { slewRate } from '../flight/autopilot';
import { orbitalElements, wrapAngle, type Vec2 } from '../flight/orbitMath';
import { burnDurationS } from '../moon/lunarTransfer';
import { outgoingAsymptote, propagateKepler } from './kepler';
import { bestTransfer, type TransferOption } from './marsTransfer';
import { programTime } from './solarSystem';

/*
 * Trans-Mars injection from the parking orbit (gameplay guidance). The transfer for the departure
 * time gives the hyperbolic excess velocity to leave Earth with; the burn is centred where a
 * prograde burn sends the outgoing asymptote along it, and ends at the matching orbital energy.
 * The finite burn is simulated with the flight model itself and its start time nudged until the
 * asymptote points the right way, so the plan matches what the ship will actually fly.
 */

/** Earliest the burn may start after planning (time to turn and settle). */
const PLAN_LEAD_S = 300;
const FINE_DT_S = 0.05;

export interface TmiPlan {
  readonly burnStartT: number;
  readonly targetEnergy: number;
  readonly dvMS: number;
  readonly transfer: TransferOption;
  /** Desired departure direction (unit vector) of the outgoing asymptote. */
  readonly direction: Vec2;
}

const energyOf = (r: Vec2, v: Vec2) =>
  (v[0] * v[0] + v[1] * v[1]) / 2 - EARTH_MU_M3S2 / Math.hypot(r[0], r[1]);

/** Controls for the injection burn: hold prograde, full throttle once aligned. */
export function tmiBurnControls(s: FlightState, burning: boolean): FlightControls {
  const pitch = flightPathAngleDeg(s.r, s.v);
  const off = Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180);
  return {
    targetPitchDeg: pitch,
    bankDeg: 0,
    yawDeg: 0,
    throttle: burning && off < 3 ? 1 : 0,
    slewDegS: slewRate(s),
  };
}

/** Simulates the burn from `start` until the target energy (or empty tanks). */
function simulateBurn(start: FlightState, spec: ShipSpec, targetEnergy: number): FlightState {
  let s = { ...start, pitchDeg: flightPathAngleDeg(start.r, start.v) };
  for (let i = 0; i < 40_000; i++) {
    if (energyOf(s.r, s.v) >= targetEnergy || s.propKg <= 0) break;
    s = stepFlight(s, spec, tmiBurnControls(s, true), FINE_DT_S);
  }
  return s;
}

/** Plans the injection from a near-circular parking orbit; null if no transfer can be planned. */
export function planTmi(s: FlightState, spec: ShipSpec, launchDay: number): TmiPlan | null {
  const el = orbitalElements(s.r, s.v);
  if (el.status !== 'orbit' || !Number.isFinite(el.periodS)) return null;
  const rPark = Math.hypot(s.r[0], s.r[1]);
  const omega = (2 * Math.PI) / el.periodS;
  const transfer = bestTransfer(programTime(launchDay, s.tS + el.periodS / 2), rPark);
  if (!transfer) return null;
  const vInf = transfer.vInfDepMS;
  const direction: Vec2 = [transfer.vInfDep[0] / vInf, transfer.vInfDep[1] / vInf];
  const targetEnergy = (vInf * vInf) / 2;
  const e = 1 + (rPark * vInf * vInf) / EARTH_MU_M3S2;
  const nuInf = Math.acos(-1 / e);
  // Periapsis of the departure hyperbola, nuInf before the asymptote (clockwise motion).
  const thetaP = Math.atan2(direction[0], direction[1]) - nuInf;
  const theta0 = Math.atan2(s.r[0], s.r[1]);
  const dv = transfer.tmiDvMS;
  const tau = burnDurationS(spec, s.propKg, dv);
  let ahead = wrapAngle(thetaP - theta0);
  if (ahead < 0) ahead += 2 * Math.PI;
  let start = s.tS + ahead / omega - tau / 2;
  while (start < s.tS + PLAN_LEAD_S) start += el.periodS;
  // Refine the start time with the simulated finite burn.
  const want = Math.atan2(direction[0], direction[1]);
  for (let it = 0; it < 4; it++) {
    const at = propagateKepler({ r: s.r, v: s.v }, EARTH_MU_M3S2, start - s.tS);
    const after = simulateBurn({ ...s, r: at.r, v: at.v, tS: start }, spec, targetEnergy);
    const asym = outgoingAsymptote(after.r, after.v, EARTH_MU_M3S2);
    if (!asym) break;
    const err = wrapAngle(Math.atan2(asym[0], asym[1]) - want);
    if (Math.abs(err) < 2e-4) break;
    start -= err / omega;
  }
  if (start < s.tS + 60) start += el.periodS;
  return { burnStartT: start, targetEnergy, dvMS: dv, transfer, direction };
}

/** Specific orbital energy about Earth (to end the burn). */
export const earthEnergy = energyOf;
