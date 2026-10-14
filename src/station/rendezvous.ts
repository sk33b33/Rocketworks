import { EARTH_MU_M3S2 } from '../simulation/constants';
import { localFrame, orbitalElements, wrapAngle } from '../flight/orbitMath';
import type { FlightControls, FlightState } from '../flight/flightModel';
import {
  STATION_N,
  STATION_RADIUS_M,
  rangeM,
  stationState,
  toStationFrame,
  type StationEphemeris,
} from './stationOrbit';

/*
 * Assisted rendezvous with the station, flown by the ship's main engines in the planar orbit
 * model:
 *   1. wait for the right phase angle, then a prograde transfer burn up to the station's altitude
 *      (Hohmann-style);
 *   2. near the top of the transfer, closed-loop targeting with the Clohessy–Wiltshire equations
 *      to a hold point a short distance ahead of the station, re-planned as it goes;
 *   3. hold: inside the hand-over range with a small relative speed, ready for proximity ops.
 * Simplified gameplay guidance, not flight software.
 */

/** Hold point ahead of the station (along-track, m): a co-orbital point stays put. */
export const HOLD_AHEAD_M = 2_000;
/** Proximity operations can start inside this range and below this relative speed. */
export const HANDOVER_RANGE_M = 3_500;
export const HANDOVER_SPEED_MS = 3;
/** Below this range the guidance flies at fine steps only (warp ≤ 10×). */
export const CLOSE_RANGE_M = 80_000;

export type RendezvousPhase = 'phasing' | 'transfer' | 'coast' | 'targeting' | 'hold';

export const RENDEZVOUS_LABELS: Record<RendezvousPhase, string> = {
  phasing: 'Waiting for the transfer window',
  transfer: 'Transfer burn',
  coast: 'Coasting up to the station',
  targeting: 'Closing on the station',
  hold: 'Holding near the station',
};

export interface RendezvousState {
  readonly phase: RendezvousPhase;
  /** Rotating-frame relative velocity the current plan wants (m/s), or null between plans. */
  readonly wantV: readonly [number, number] | null;
  readonly burning: boolean;
  readonly planT: number;
  /** Time the current CW leg should arrive at the hold point. */
  readonly arriveT: number;
}

export const RENDEZVOUS_START: RendezvousState = {
  phase: 'phasing',
  wantV: null,
  burning: false,
  planT: -Infinity,
  arriveT: 0,
};

/** In-plane Clohessy–Wiltshire: initial rotating-frame velocity reaching `pf` from `p0` in T. */
export function cwTargetVelocity(
  p0: readonly [number, number],
  pf: readonly [number, number],
  T: number,
  n = STATION_N,
): [number, number] {
  const s = Math.sin(n * T);
  const c = Math.cos(n * T);
  const [x0, y0] = p0;
  const a11 = s / n;
  const a12 = (2 * (1 - c)) / n;
  const a21 = (-2 * (1 - c)) / n;
  const a22 = (4 * s - 3 * n * T) / n;
  const b1 = pf[0] - (4 - 3 * c) * x0;
  const b2 = pf[1] - 6 * (s - n * T) * x0 - y0;
  const det = a11 * a22 - a12 * a21;
  return [(b1 * a22 - a12 * b2) / det, (a11 * b2 - a21 * b1) / det];
}

/** Phase angle (station ahead of the ship, radians) at which to start the transfer burn. */
export function transferPhase(shipRadiusM: number): number {
  const a = (shipRadiusM + STATION_RADIUS_M) / 2;
  const transferS = Math.PI * Math.sqrt((a * a * a) / EARTH_MU_M3S2);
  return wrapAngle(Math.PI - STATION_N * transferS - HOLD_AHEAD_M / STATION_RADIUS_M);
}

export interface RendezvousView {
  readonly rangeM: number;
  readonly relSpeedMS: number;
  /** Seconds until the transfer burn (phasing only). */
  readonly toBurnS: number | null;
}

export function rendezvousView(
  rs: RendezvousState,
  s: FlightState,
  eph: StationEphemeris,
): RendezvousView {
  const st = stationState(eph, s.tS);
  const rel = toStationFrame(st, s.r, s.v);
  let toBurnS: number | null = null;
  if (rs.phase === 'phasing') {
    const f = localFrame(s.r);
    const radius = f.altitudeM + 6_371_000;
    const nShip = Math.sqrt(EARTH_MU_M3S2 / radius ** 3);
    const phase = wrapAngle(st.angle - f.groundAngle);
    const diff = (((phase - transferPhase(radius)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    toBurnS = nShip > STATION_N ? diff / (nShip - STATION_N) : null;
  }
  return { rangeM: rangeM(rel), relSpeedMS: Math.hypot(rel.v[0], rel.v[1]), toBurnS };
}

export interface RendezvousOutput {
  readonly controls: Omit<FlightControls, 'slewDegS' | 'yawDeg'>;
  readonly next: RendezvousState;
  readonly message?: string;
}

/** Points the main engine along a rotating-frame Δv (pitch above the local horizon, deg). */
function pitchFor(dv: readonly [number, number]): number {
  return (Math.atan2(dv[0], dv[1]) * 180) / Math.PI;
}

const aligned = (s: FlightState, pitch: number) =>
  Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180) < 4;

/** Runs the rendezvous guidance for one step. */
export function runRendezvous(
  rs: RendezvousState,
  s: FlightState,
  eph: StationEphemeris,
): RendezvousOutput {
  const st = stationState(eph, s.tS);
  const rel = toStationFrame(st, s.r, s.v);
  const el = orbitalElements(s.r, s.v);
  const f = localFrame(s.r);
  const coast = (pitch: number): RendezvousOutput['controls'] => ({
    targetPitchDeg: pitch,
    bankDeg: 0,
    throttle: 0,
  });
  const range = rangeM(rel);
  const prograde = el.flightPathAngleDeg;

  // Close enough for CW targeting from any phase.
  if (
    (rs.phase === 'phasing' || rs.phase === 'coast') &&
    range < CLOSE_RANGE_M &&
    el.verticalSpeedMS < 20
  ) {
    return {
      controls: coast(prograde),
      next: { ...rs, phase: 'targeting', wantV: null, planT: -Infinity, burning: false },
      message: 'Closing on the station.',
    };
  }

  switch (rs.phase) {
    case 'phasing': {
      const radius = f.altitudeM + 6_371_000;
      const phase = wrapAngle(st.angle - f.groundAngle);
      const err = wrapAngle(phase - transferPhase(radius));
      // The station drifts back relative to the faster ship: burn as the phase passes the mark.
      if (err <= 0 && err > -0.02) {
        return {
          controls: coast(prograde),
          next: { ...rs, phase: 'transfer', burning: true },
          message: 'Transfer burn.',
        };
      }
      return { controls: coast(prograde), next: rs };
    }
    case 'transfer': {
      if (el.apoapsisAltM >= STATION_RADIUS_M - 6_371_000 - 300) {
        return {
          controls: coast(prograde),
          next: { ...rs, phase: 'coast', burning: false },
          message: 'Transfer burn complete.',
        };
      }
      return {
        controls: { targetPitchDeg: prograde, bankDeg: 0, throttle: aligned(s, prograde) ? 1 : 0 },
        next: rs,
      };
    }
    case 'coast':
      return { controls: coast(prograde), next: rs };
    case 'targeting':
    case 'hold': {
      const holdP: [number, number] = [0, HOLD_AHEAD_M];
      const errP = Math.hypot(rel.p[0] - holdP[0], rel.p[1] - holdP[1]);
      const speed = Math.hypot(rel.v[0], rel.v[1]);
      if (range < HANDOVER_RANGE_M && speed < HANDOVER_SPEED_MS && errP < 1_500) {
        return {
          controls: coast(s.pitchDeg),
          next: { ...rs, phase: 'hold', burning: false, wantV: null },
          ...(rs.phase !== 'hold'
            ? { message: 'Holding 2 km ahead of the station: ready for proximity operations.' }
            : {}),
        };
      }
      let next = rs;
      // Re-plan every minute (or when there is no plan): arrive in about a quarter orbit,
      // shortening as the hold point gets close; the final leg nulls the velocity.
      if (!rs.burning && (rs.wantV === null || s.tS - rs.planT > 60)) {
        const T = Math.max(240, Math.min(1_400, rs.arriveT > s.tS ? rs.arriveT - s.tS : 1_400));
        const finalLeg = errP < 400;
        const want: [number, number] = finalLeg
          ? [0, 0]
          : cwTargetVelocity([rel.p[0], rel.p[1]], holdP, T);
        next = {
          ...rs,
          phase: 'targeting',
          wantV: want,
          planT: s.tS,
          arriveT: finalLeg ? s.tS : s.tS + T,
        };
      }
      const want = next.wantV;
      if (!want) return { controls: coast(prograde), next };
      const dv: [number, number] = [want[0] - rel.v[0], want[1] - rel.v[1]];
      const need = Math.hypot(dv[0], dv[1]);
      const pitch = pitchFor(dv);
      const burn = need > (next.burning ? 0.25 : 0.8);
      if (!burn) return { controls: coast(s.pitchDeg), next: { ...next, burning: false } };
      // A small Δv only needs a short pulse at minimum thrust.
      return {
        controls: {
          targetPitchDeg: pitch,
          bankDeg: 0,
          throttle: aligned(s, pitch) ? Math.min(1, need / 40) : 0,
        },
        next: { ...next, burning: true },
      };
    }
  }
}
