import type { Vec2 } from '../flight/orbitMath';
import { angularMomentum, periapsisRadius, propagateKepler, type KeplerState } from './kepler';
import { entrySpeed } from './marsTransfer';
import {
  DAY_S,
  MARS_INTERFACE_M,
  MARS_MU_M3S2,
  MARS_RADIUS_M,
  MARS_SOI_M,
  planetState,
  SUN_MU_M3S2,
} from './solarSystem';

/*
 * Cruise navigation with patched conics (gameplay guidance). Between the planets the ship follows
 * a Sun-centred conic; its aim at Mars is judged by the signed impact parameter (b) of the
 * straight-line approach, which gravity doesn't change: the pass is clockwise when b < 0. Inside
 * Mars's sphere of influence the exact Mars-centred hyperbola gives the periapsis. Corrections
 * are small impulses solved by the secant method along the most effective direction.
 */

/** Entry flight-path angle the approach is aimed for (deg, below the horizon). */
export const ENTRY_FPA_DEG = -12;

export interface ArrivalPrediction {
  /** Program time of closest (straight-line) approach. */
  readonly closestT: number;
  /** Signed impact parameter (m; negative = clockwise pass). */
  readonly signedB: number;
  /** Approach speed relative to Mars (m/s). */
  readonly vInfMS: number;
  /** Time the ship enters Mars's sphere of influence (null if it misses it). */
  readonly soiT: number | null;
}

/** Impact parameter that gives the entry flight-path angle at the interface, for a v∞. */
export function targetImpactParameter(vInfMS: number): number {
  const ri = MARS_RADIUS_M + MARS_INTERFACE_M;
  const vi = entrySpeed(vInfMS);
  const h = ri * vi * Math.cos((ENTRY_FPA_DEG * Math.PI) / 180);
  return h / vInfMS;
}

/** Periapsis radius aimed for from inside the sphere of influence (same flight-path target). */
export function targetPeriapsisRadius(vInfMS: number): number {
  const h = targetImpactParameter(vInfMS) * vInfMS;
  const mu = MARS_MU_M3S2;
  return (-mu + Math.sqrt(mu * mu + vInfMS * vInfMS * h * h)) / (vInfMS * vInfMS);
}

const relTo = (s: KeplerState, T: number) => {
  const m = planetState('mars', T);
  return {
    r: [s.r[0] - m.r[0], s.r[1] - m.r[1]] as Vec2,
    v: [s.v[0] - m.v[0], s.v[1] - m.v[1]] as Vec2,
  };
};

/**
 * Predicts the heliocentric approach to Mars from (helio state at program time T0), ignoring
 * Mars's gravity: steps a day at a time to the closest approach, then refines it.
 */
export function predictArrival(
  s: KeplerState,
  T0: number,
  maxDays = 420,
): ArrivalPrediction | null {
  const dist = (t: number) => {
    const p = propagateKepler(s, SUN_MU_M3S2, t - T0);
    const rel = relTo(p, t);
    return Math.hypot(rel.r[0], rel.r[1]);
  };
  let bestT = T0;
  let best = dist(T0);
  let prev = best;
  let rising = 0;
  for (let d = 1; d <= maxDays; d++) {
    const t = T0 + d * DAY_S;
    const x = dist(t);
    if (x < best) {
      best = x;
      bestT = t;
      rising = 0;
    } else if (x > prev && best < 5e10) {
      // Past the closest approach for good.
      if (++rising > 3) break;
    }
    prev = x;
  }
  // Golden-section refinement within a day either side.
  let lo = Math.max(T0, bestT - DAY_S);
  let hi = bestT + DAY_S;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const a = hi - phi * (hi - lo);
    const b = lo + phi * (hi - lo);
    if (dist(a) < dist(b)) hi = b;
    else lo = a;
  }
  const tCa = (lo + hi) / 2;
  const p = propagateKepler(s, SUN_MU_M3S2, tCa - T0);
  const rel = relTo(p, tCa);
  const u = Math.hypot(rel.v[0], rel.v[1]);
  const signedB = angularMomentum(rel.r, rel.v) / u;
  // Sphere-of-influence crossing (bisection between the start and closest approach).
  let soiT: number | null = null;
  if (Math.hypot(rel.r[0], rel.r[1]) < MARS_SOI_M) {
    if (dist(T0) <= MARS_SOI_M) soiT = T0;
    else {
      let a = T0;
      let b = tCa;
      for (let i = 0; i < 50; i++) {
        const m = (a + b) / 2;
        if (dist(m) > MARS_SOI_M) a = m;
        else b = m;
      }
      soiT = b;
    }
  }
  return { closestT: tCa, signedB, vInfMS: u, soiT };
}

/** Aim error of a heliocentric approach (m): zero when the pass is clockwise at the entry aim. */
export function cruiseMetric(s: KeplerState, T0: number): number | null {
  const p = predictArrival(s, T0);
  if (!p) return null;
  return p.signedB + targetImpactParameter(p.vInfMS);
}

/** Aim error of a Mars-centred approach (m): signed periapsis minus the entry aim. */
export function approachMetric(rel: KeplerState): number {
  const v = Math.hypot(rel.v[0], rel.v[1]);
  const energy = (v * v) / 2 - MARS_MU_M3S2 / Math.hypot(rel.r[0], rel.r[1]);
  const vInf = Math.sqrt(Math.max(1, 2 * energy));
  const rp = periapsisRadius(rel.r, rel.v, MARS_MU_M3S2);
  const signed = angularMomentum(rel.r, rel.v) < 0 ? rp : -rp;
  return signed - targetPeriapsisRadius(vInf);
}

/**
 * Smallest correction (Δv vector) zeroing `metric` for an impulse at state `s`: tries the
 * velocity direction and the in-plane normal, keeps the more effective, and runs the secant
 * method on its size. Null if neither direction converges.
 */
export function solveImpulse(
  s: KeplerState,
  metric: (s: KeplerState) => number | null,
  toleranceM: number,
  maxDvMS = 400,
): Vec2 | null {
  const f0 = metric(s);
  if (f0 === null) return null;
  if (Math.abs(f0) < toleranceM) return [0, 0];
  const speed = Math.hypot(s.v[0], s.v[1]);
  const along: Vec2 = [s.v[0] / speed, s.v[1] / speed];
  const normal: Vec2 = [-along[1], along[0]];
  const apply = (dir: Vec2, x: number): KeplerState => ({
    r: s.r,
    v: [s.v[0] + dir[0] * x, s.v[1] + dir[1] * x],
  });
  let best: { dir: Vec2; slope: number } | null = null;
  for (const dir of [along, normal]) {
    const f1 = metric(apply(dir, 0.5));
    if (f1 === null) continue;
    const slope = (f1 - f0) / 0.5;
    if (!best || Math.abs(slope) > Math.abs(best.slope)) best = { dir, slope };
  }
  if (!best || best.slope === 0) return null;
  let x0 = 0;
  let y0 = f0;
  let x1 = -f0 / best.slope;
  for (let i = 0; i < 12; i++) {
    if (Math.abs(x1) > maxDvMS) return null;
    const y1 = metric(apply(best.dir, x1));
    if (y1 === null) return null;
    if (Math.abs(y1) < toleranceM) return [best.dir[0] * x1, best.dir[1] * x1];
    const denom = y1 - y0;
    if (denom === 0) return null;
    const x2 = x1 - (y1 * (x1 - x0)) / denom;
    x0 = x1;
    y0 = y1;
    x1 = x2;
  }
  return null;
}

/** Time (s) from a Mars-centred state until it descends to `radius`, or null if it never does. */
export function timeToRadius(rel: KeplerState, radius: number, maxS = 30 * DAY_S): number | null {
  const r0 = Math.hypot(rel.r[0], rel.r[1]);
  if (r0 <= radius) return 0;
  // Coarse steps to bracket the crossing, then bisection.
  let t = 0;
  let step = Math.max(60, (r0 - radius) / 20_000);
  let prevT = 0;
  while (t < maxS) {
    t = Math.min(maxS, t + step);
    const p = propagateKepler(rel, MARS_MU_M3S2, t);
    const r = Math.hypot(p.r[0], p.r[1]);
    if (r <= radius) {
      let a = prevT;
      let b = t;
      for (let i = 0; i < 50; i++) {
        const m = (a + b) / 2;
        const q = propagateKepler(rel, MARS_MU_M3S2, m);
        if (Math.hypot(q.r[0], q.r[1]) > radius) a = m;
        else b = m;
      }
      return b;
    }
    // Moving away after periapsis: no crossing.
    const radial = p.r[0] * p.v[0] + p.r[1] * p.v[1];
    if (radial > 0 && t > step) return null;
    prevT = t;
    step = Math.max(30, Math.min(step * 1.5, (r - radius) / 8_000));
  }
  return null;
}
