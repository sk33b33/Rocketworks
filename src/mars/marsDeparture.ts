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
import { bestTransfer, type Leg, type TransferOption } from './marsTransfer';
import { MARS_BODY, MARS_MU_M3S2, programTime } from './solarSystem';

/*
 * Interplanetary injection from a parking orbit (gameplay guidance): trans-Mars injection from
 * Earth orbit and trans-Earth injection from Mars orbit. The transfer for the departure time
 * gives the hyperbolic excess velocity to leave with; the burn is centred where a prograde burn
 * sends the outgoing asymptote along it, and ends at the matching orbital energy. The finite burn
 * is simulated with the flight model itself and its start time nudged until the asymptote points
 * the right way, so the plan matches what the ship will actually fly.
 */

/** The body being left: its gravity and how the ship is stepped near it. */
export interface DepartureBody {
  readonly leg: Leg;
  readonly mu: number;
  readonly step: (s: FlightState, spec: ShipSpec, c: FlightControls, dt: number) => FlightState;
  readonly slew: (s: FlightState) => number;
}

export const EARTH_DEPARTURE: DepartureBody = {
  leg: 'out',
  mu: EARTH_MU_M3S2,
  step: (s, spec, c, dt) => stepFlight(s, spec, c, dt),
  slew: slewRate,
};

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

/** Specific orbital energy about a body. */
export const orbitEnergy = (r: Vec2, v: Vec2, mu = EARTH_MU_M3S2) =>
  (v[0] * v[0] + v[1] * v[1]) / 2 - mu / Math.hypot(r[0], r[1]);

/** Controls for the injection burn: hold prograde, full throttle once aligned. */
export function tmiBurnControls(
  s: FlightState,
  burning: boolean,
  slew: (s: FlightState) => number = slewRate,
): FlightControls {
  const pitch = flightPathAngleDeg(s.r, s.v);
  const off = Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180);
  return {
    targetPitchDeg: pitch,
    bankDeg: 0,
    yawDeg: 0,
    throttle: burning && off < 3 ? 1 : 0,
    slewDegS: slew(s),
  };
}

/** Simulates the burn from `start` until the target energy (or empty tanks). */
function simulateBurn(
  start: FlightState,
  spec: ShipSpec,
  targetEnergy: number,
  body: DepartureBody,
): FlightState {
  let s = { ...start, pitchDeg: flightPathAngleDeg(start.r, start.v) };
  for (let i = 0; i < 40_000; i++) {
    if (orbitEnergy(s.r, s.v, body.mu) >= targetEnergy || s.propKg <= 0) break;
    s = body.step(s, spec, tmiBurnControls(s, true, body.slew), FINE_DT_S);
  }
  return s;
}

/** Plans trans-Mars injection from a near-circular Earth parking orbit (null if impossible). */
export function planTmi(s: FlightState, spec: ShipSpec, launchDay: number): TmiPlan | null {
  return planInjection(s, spec, (tS) => programTime(launchDay, tS), EARTH_DEPARTURE);
}

/**
 * Plans an injection from a near-circular parking orbit around `body`; `programT` converts the
 * flight clock to program time. Null if no transfer can be planned.
 */
export function planInjection(
  s: FlightState,
  spec: ShipSpec,
  programT: (tS: number) => number,
  body: DepartureBody,
): TmiPlan | null {
  const el = orbitalElements(s.r, s.v, body.leg === 'home' ? MARS_BODY : undefined);
  if (el.status !== 'orbit' || !Number.isFinite(el.periodS)) return null;
  const rPark = Math.hypot(s.r[0], s.r[1]);
  const omega = (2 * Math.PI) / el.periodS;
  const transfer = bestTransfer(programT(s.tS + el.periodS / 2), rPark, body.leg);
  if (!transfer) return null;
  const vInf = transfer.vInfDepMS;
  const direction: Vec2 = [transfer.vInfDep[0] / vInf, transfer.vInfDep[1] / vInf];
  const targetEnergy = (vInf * vInf) / 2;
  const e = 1 + (rPark * vInf * vInf) / body.mu;
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
    const at = propagateKepler({ r: s.r, v: s.v }, body.mu, start - s.tS);
    const after = simulateBurn({ ...s, r: at.r, v: at.v, tS: start }, spec, targetEnergy, body);
    const asym = outgoingAsymptote(after.r, after.v, body.mu);
    if (!asym) break;
    const err = wrapAngle(Math.atan2(asym[0], asym[1]) - want);
    if (Math.abs(err) < 2e-4) break;
    start -= err / omega;
  }
  if (start < s.tS + 60) start += el.periodS;
  return { burnStartT: start, targetEnergy, dvMS: dv, transfer, direction };
}

/** Specific orbital energy about Earth (to end the burn). */
export const earthEnergy = (r: Vec2, v: Vec2) => orbitEnergy(r, v);

/** Specific orbital energy about Mars. */
export const marsEnergy = (r: Vec2, v: Vec2) => orbitEnergy(r, v, MARS_MU_M3S2);
