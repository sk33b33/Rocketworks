import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import { cross, type Vec2 } from '../flight/orbitMath';
import {
  gravityAccel,
  moonState,
  MOON_DISTANCE_M,
  MOON_MU_M3S2,
  MOON_N,
  MOON_RADIUS_M,
  type GravityEnv,
} from './moonOrbit';

/*
 * Unpowered trajectory prediction in the Earth–Moon model, using the same integrator as the
 * flight model (semi-implicit Euler) so predictions match what the simulation will do. The step
 * adapts to the local dynamical time: about a second near Earth, minutes in deep space.
 */

export interface CoastState {
  readonly r: Vec2;
  readonly v: Vec2;
  readonly tS: number;
}

/** Atmosphere interface for predictions (re-entry starts below this altitude). */
export const ENTRY_INTERFACE_M = 120_000;
/** Step divisor of the dynamical time: the simulation's own coasting step. */
export const SIM_DT_DIVISOR = 400;
/** Cheaper steps for scanning many candidate plans. */
export const SCAN_DT_DIVISOR = 400;

/** Coasting step (s) for the current position: a fraction of the shorter dynamical time. */
export function coastDt(r: Vec2, tS: number, env: GravityEnv, divisor = SIM_DT_DIVISOR): number {
  const dE = Math.hypot(r[0], r[1]);
  const m = moonState(env.moon, tS);
  const dM = Math.hypot(r[0] - m.r[0], r[1] - m.r[1]);
  const tDyn = Math.min(Math.sqrt(dE ** 3 / EARTH_MU_M3S2), Math.sqrt(dM ** 3 / MOON_MU_M3S2));
  return Math.max(1, Math.min(120, tDyn / divisor));
}

export function coastStep(s: CoastState, dt: number, env: GravityEnv): CoastState {
  const a = gravityAccel(s.r, s.tS, env);
  const v: Vec2 = [s.v[0] + a[0] * dt, s.v[1] + a[1] * dt];
  return { tS: s.tS + dt, v, r: [s.r[0] + v[0] * dt, s.r[1] + v[1] * dt] };
}

export type StopReason = 'time' | 'entry' | 'moon-impact' | 'stop';

export interface PredictOptions {
  readonly maxS?: number;
  /** Step divisor (higher = finer and slower). */
  readonly divisor?: number;
}

/**
 * Coasts until `maxS` has passed, the ship hits Earth's atmosphere or the Moon, or `visit` stops
 * it. The inner loop works on scalars (no allocations) because plans call it many times; the
 * maths is identical to `coastStep`.
 */
export function propagate(
  s0: CoastState,
  env: GravityEnv,
  maxS: number,
  visit?: (s: CoastState) => boolean | void,
  divisor = SIM_DT_DIVISOR,
): { end: CoastState; reason: StopReason } {
  let x = s0.r[0];
  let y = s0.r[1];
  let vx = s0.v[0];
  let vy = s0.v[1];
  let t = s0.tS;
  const tEnd = s0.tS + maxS;
  const entryR = EARTH_RADIUS_M + ENTRY_INTERFACE_M;
  const kI = -MOON_MU_M3S2 / MOON_DISTANCE_M ** 3;
  const { angle0, t0 } = env.moon;
  let reason: StopReason = 'time';
  while (t < tEnd - 1e-6) {
    // Moon position at t (circular orbit).
    const a = angle0 + MOON_N * (t - t0);
    const mx = Math.sin(a) * MOON_DISTANCE_M;
    const my = Math.cos(a) * MOON_DISTANCE_M;
    const rE = Math.sqrt(x * x + y * y);
    const dx = x - mx;
    const dy = y - my;
    const dM = Math.sqrt(dx * dx + dy * dy);
    // Adaptive step (same rule as coastDt).
    const tDyn = Math.min(
      Math.sqrt((rE * rE * rE) / EARTH_MU_M3S2),
      Math.sqrt((dM * dM * dM) / MOON_MU_M3S2),
    );
    let dt = Math.max(1, Math.min(120, tDyn / divisor));
    if (dt > tEnd - t) dt = Math.max(1e-3, tEnd - t);
    const kE = -EARTH_MU_M3S2 / (rE * rE * rE);
    const kM = -MOON_MU_M3S2 / (dM * dM * dM);
    vx += (kE * x + kM * dx + kI * mx) * dt;
    vy += (kE * y + kM * dy + kI * my) * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    if (x * x + y * y < entryR * entryR) {
      reason = 'entry';
      break;
    }
    const a2 = angle0 + MOON_N * (t - t0);
    const ex = x - Math.sin(a2) * MOON_DISTANCE_M;
    const ey = y - Math.cos(a2) * MOON_DISTANCE_M;
    if (ex * ex + ey * ey < MOON_RADIUS_M * MOON_RADIUS_M) {
      reason = 'moon-impact';
      break;
    }
    if (visit?.({ r: [x, y], v: [vx, vy], tS: t })) {
      reason = 'stop';
      break;
    }
  }
  return { end: { r: [x, y], v: [vx, vy], tS: t }, reason };
}

/** Periapsis radius of the conic through (r, v) about a body with gravitational parameter mu. */
export function conicPeriapsis(r: Vec2, v: Vec2, mu: number): number {
  const rMag = Math.hypot(r[0], r[1]);
  const v2 = v[0] * v[0] + v[1] * v[1];
  const h = cross(r, v);
  const energy = v2 / 2 - mu / rMag;
  const p = (h * h) / mu;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
  return p / (1 + e);
}

export interface ReturnLeg {
  /** Lowest altitude over Earth (m; the conic's vacuum perigee once inside the atmosphere). */
  readonly perigeeAltM: number;
  readonly perigeeT: number;
  /** Ground angle at perigee / the entry interface. */
  readonly entryAngle: number;
}

export interface LunarPass {
  /** Closest approach to the Moon (altitude, m; negative = the path goes into the Moon). */
  readonly periAltM: number;
  /**
   * Signed closest-approach distance from the Moon's centre (m): positive for a clockwise pass
   * (the game's prograde sense), negative anticlockwise. Continuous through a head-on path, so it
   * suits targeting.
   */
  readonly signedMissM: number;
  readonly periT: number;
  readonly sense: 1 | -1;
  /** The return to Earth after the pass (null if it doesn't come back within the window). */
  readonly after: ReturnLeg | null;
}

/** Predicts the next pass by the Moon and, optionally, the return to Earth afterwards. */
export function predictLunarPass(
  s0: CoastState,
  env: GravityEnv,
  opts: PredictOptions & { readonly withReturn?: boolean; readonly maxApproachM?: number } = {},
): LunarPass | null {
  const maxS = opts.maxS ?? 8 * 86_400;
  const maxApproach = opts.maxApproachM ?? 60_000_000;
  let best = Infinity;
  let bestState: CoastState | null = null;
  let rising = 0;
  const out = propagate(
    s0,
    env,
    maxS,
    (s) => {
      const m = moonState(env.moon, s.tS);
      const d = Math.hypot(s.r[0] - m.r[0], s.r[1] - m.r[1]);
      if (d < best) {
        best = d;
        bestState = s;
        rising = 0;
      } else rising++;
      return bestState !== null && best < maxApproach && rising > 40;
    },
    opts.divisor,
  );
  const b: CoastState | null = out.reason === 'moon-impact' ? out.end : bestState;
  if (!b || (out.reason !== 'moon-impact' && best > maxApproach)) return null;
  const m = moonState(env.moon, b.tS);
  const rRel: Vec2 = [b.r[0] - m.r[0], b.r[1] - m.r[1]];
  const vRel: Vec2 = [b.v[0] - m.v[0], b.v[1] - m.v[1]];
  // Into the Moon: use the closest approach of the selenocentric conic instead.
  const periDist = out.reason === 'moon-impact' ? conicPeriapsis(rRel, vRel, MOON_MU_M3S2) : best;
  const sense: 1 | -1 = cross(rRel, vRel) < 0 ? 1 : -1;
  const after =
    opts.withReturn && out.reason === 'stop'
      ? predictReturn(out.end, env, {
          maxS: maxS - (out.end.tS - s0.tS) + 86_400,
          divisor: opts.divisor,
        })
      : null;
  return {
    periAltM: periDist - MOON_RADIUS_M,
    signedMissM: sense * periDist,
    periT: b.tS,
    sense,
    after,
  };
}

/** Coasts toward Earth and reports the perigee (or the vacuum perigee once at the interface). */
export function predictReturn(
  s0: CoastState,
  env: GravityEnv,
  opts: PredictOptions = {},
): ReturnLeg | null {
  const low: { alt: number; at: CoastState | null } = { alt: Infinity, at: null };
  let rising = 0;
  const out = propagate(
    s0,
    env,
    opts.maxS ?? 8 * 86_400,
    (s) => {
      const alt = Math.hypot(s.r[0], s.r[1]) - EARTH_RADIUS_M;
      if (alt < low.alt) {
        low.alt = alt;
        low.at = s;
        rising = 0;
      } else rising++;
      return low.at !== null && low.alt < 30_000_000 && rising > 40;
    },
    opts.divisor,
  );
  if (out.reason === 'entry') {
    const e = out.end;
    return {
      perigeeAltM: conicPeriapsis(e.r, e.v, EARTH_MU_M3S2) - EARTH_RADIUS_M,
      perigeeT: e.tS,
      entryAngle: Math.atan2(e.r[0], e.r[1]),
    };
  }
  const ms = low.at;
  if (!ms || low.alt > 30_000_000) return null;
  return { perigeeAltM: low.alt, perigeeT: ms.tS, entryAngle: Math.atan2(ms.r[0], ms.r[1]) };
}

/** Samples the predicted path (for the map): Earth-centred positions, evenly in time. */
export function samplePath(s0: CoastState, env: GravityEnv, maxS: number, maxPoints = 300): Vec2[] {
  const pts: Vec2[] = [s0.r];
  const every = maxS / maxPoints;
  let next = s0.tS + every;
  const out = propagate(
    s0,
    env,
    maxS,
    (s) => {
      if (s.tS >= next) {
        pts.push(s.r);
        next += every;
      }
      return pts.length >= maxPoints;
    },
    SCAN_DT_DIVISOR,
  );
  if (out.reason !== 'time') pts.push(out.end.r);
  return pts;
}
