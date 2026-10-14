import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import { surfacePoint, wrapAngle, type Vec2 } from '../flight/orbitMath';

/*
 * The fictional orbital station: a circular orbit in the game's single orbital plane, moving
 * eastward (clockwise) like the ship. Its position is analytic, so it never drifts.
 *
 * Proximity operations use the station's local frame (LVLH), in metres:
 *   x = radial (up), y = along-track (direction of motion), z = cross-track.
 * Planar ship states convert to and from this frame exactly (z is the only out-of-plane axis).
 */

export const STATION_ALT_M = 400_000;
export const STATION_RADIUS_M = EARTH_RADIUS_M + STATION_ALT_M;
/** Mean motion (rad/s). */
export const STATION_N = Math.sqrt(EARTH_MU_M3S2 / STATION_RADIUS_M ** 3);
export const STATION_SPEED_MS = Math.sqrt(EARTH_MU_M3S2 / STATION_RADIUS_M);

export interface StationEphemeris {
  /** Ground angle of the station at time t0 (radians). */
  readonly angle0: number;
  readonly t0: number;
}

export function stationAngle(e: StationEphemeris, tS: number): number {
  return wrapAngle(e.angle0 + STATION_N * (tS - e.t0));
}

export interface StationState {
  readonly angle: number;
  readonly r: Vec2;
  readonly v: Vec2;
  readonly up: Vec2;
  readonly east: Vec2;
}

export function stationState(e: StationEphemeris, tS: number): StationState {
  const angle = stationAngle(e, tS);
  const r = surfacePoint(angle, STATION_ALT_M);
  const up: Vec2 = [Math.sin(angle), Math.cos(angle)];
  const east: Vec2 = [up[1], -up[0]];
  return { angle, r, v: [east[0] * STATION_SPEED_MS, east[1] * STATION_SPEED_MS], up, east };
}

/** Relative state in the station frame (planar part; z = 0). */
export interface Relative3 {
  readonly p: readonly [number, number, number];
  readonly v: readonly [number, number, number];
}

/** Planar ship state → station-frame relative position and velocity (rotating frame). */
export function toStationFrame(st: StationState, r: Vec2, v: Vec2): Relative3 {
  const d: Vec2 = [r[0] - st.r[0], r[1] - st.r[1]];
  const dv: Vec2 = [v[0] - st.v[0], v[1] - st.v[1]];
  const x = d[0] * st.up[0] + d[1] * st.up[1];
  const y = d[0] * st.east[0] + d[1] * st.east[1];
  // The frame rotates with the station: up turns toward east at rate n.
  const vx = dv[0] * st.up[0] + dv[1] * st.up[1] + STATION_N * y;
  const vy = dv[0] * st.east[0] + dv[1] * st.east[1] - STATION_N * x;
  return { p: [x, y, 0], v: [vx, vy, 0] };
}

/** Station-frame relative state → planar ship state (cross-track motion is dropped). */
export function fromStationFrame(st: StationState, rel: Relative3): { r: Vec2; v: Vec2 } {
  const [x, y] = rel.p;
  const [vx, vy] = rel.v;
  const du = vx - STATION_N * y;
  const de = vy + STATION_N * x;
  return {
    r: [st.r[0] + st.up[0] * x + st.east[0] * y, st.r[1] + st.up[1] * x + st.east[1] * y],
    v: [st.v[0] + st.up[0] * du + st.east[0] * de, st.v[1] + st.up[1] * du + st.east[1] * de],
  };
}

export function rangeM(rel: Relative3): number {
  return Math.hypot(rel.p[0], rel.p[1], rel.p[2]);
}
