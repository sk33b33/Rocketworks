import type { Vec2 } from '../flight/orbitMath';

/*
 * Two-body (Keplerian) motion in the plane, solved analytically with universal variables so it
 * works for ellipses and hyperbolas alike and can jump any time ahead in one call. Used for the
 * interplanetary cruise and the approach to Mars (patched conics), where it replaces step-by-step
 * integration: exact for the model and fast enough to plan with.
 */

export interface KeplerState {
  readonly r: Vec2;
  readonly v: Vec2;
}

/** Stumpff functions C(z) and S(z), with series near zero for accuracy. */
function stumpff(z: number): [number, number] {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return [(1 - Math.cos(s)) / z, (s - Math.sin(s)) / (s * s * s)];
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return [(Math.cosh(s) - 1) / -z, (Math.sinh(s) - s) / (s * s * s)];
  }
  return [1 / 2 - z / 24 + (z * z) / 720, 1 / 6 - z / 120 + (z * z) / 5040];
}

/** Propagates (r, v) about a body with gravitational parameter `mu` by `dt` seconds. */
export function propagateKepler(s: KeplerState, mu: number, dt: number): KeplerState {
  if (dt === 0) return s;
  const [x0, y0] = s.r;
  const [vx0, vy0] = s.v;
  const r0 = Math.hypot(x0, y0);
  const v0sq = vx0 * vx0 + vy0 * vy0;
  const vr0 = (x0 * vx0 + y0 * vy0) / r0;
  const alpha = 2 / r0 - v0sq / mu;
  const sqmu = Math.sqrt(mu);
  // Initial guess for the universal anomaly.
  let chi: number;
  if (alpha > 1e-12) {
    chi = sqmu * alpha * dt;
  } else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const sign = Math.sign(dt);
    const num = -2 * mu * alpha * dt;
    const den = r0 * vr0 + sign * Math.sqrt(-mu * a) * (1 - r0 * alpha);
    chi = sign * Math.sqrt(-a) * Math.log(Math.max(1e-12, num / den));
    if (!Number.isFinite(chi)) chi = sqmu * Math.abs(alpha) * dt;
  } else {
    chi = (sqmu * dt) / r0;
  }
  // Laguerre–Conway iteration on the universal Kepler equation: unlike plain Newton it doesn't
  // overshoot on long hyperbolic arcs.
  const a1 = (r0 * vr0) / sqmu;
  const a2 = 1 - alpha * r0;
  const n = 5;
  for (let i = 0; i < 80; i++) {
    const z = alpha * chi * chi;
    const [C, S] = stumpff(z);
    const chi2 = chi * chi;
    const F = a1 * chi2 * C + a2 * chi2 * chi * S + r0 * chi - sqmu * dt;
    const dF = a1 * chi * (1 - z * S) + a2 * chi2 * C + r0;
    const ddF = a1 * (1 - z * C) + a2 * chi * (1 - z * S);
    const root = Math.sqrt(Math.abs((n - 1) * (n - 1) * dF * dF - n * (n - 1) * F * ddF));
    const den = dF + Math.sign(dF || 1) * root;
    const step = (n * F) / den;
    chi -= step;
    if (Math.abs(step) < 1e-10 * Math.max(1, Math.abs(chi))) break;
  }
  const z = alpha * chi * chi;
  const [C, S] = stumpff(z);
  const chi2 = chi * chi;
  const f = 1 - (chi2 / r0) * C;
  const g = dt - (chi2 * chi * S) / sqmu;
  const x = f * x0 + g * vx0;
  const y = f * y0 + g * vy0;
  const r = Math.hypot(x, y);
  const fdot = (sqmu / (r * r0)) * (z * S - 1) * chi;
  const gdot = 1 - (chi2 / r) * C;
  return { r: [x, y], v: [fdot * x0 + gdot * vx0, fdot * y0 + gdot * vy0] };
}

/**
 * Planar transfer ("Lambert") problem: the velocity at r1 that reaches r2 after `tof` seconds,
 * moving clockwise (single revolution). Solved by Newton iteration on the departure velocity
 * with the analytic propagator, starting from `guess` (or a tangential ellipse). Returns null
 * if it doesn't converge.
 */
export function solveTransfer(
  r1: Vec2,
  r2: Vec2,
  tof: number,
  mu: number,
  guess?: Vec2,
  tolM = 1_000,
): { v1: Vec2; v2: Vec2 } | null {
  let v: [number, number];
  if (guess) v = [guess[0], guess[1]];
  else {
    const m1 = Math.hypot(r1[0], r1[1]);
    const m2 = Math.hypot(r2[0], r2[1]);
    const a = (m1 + m2) / 2;
    const speed = Math.sqrt(mu * (2 / m1 - 1 / a));
    // Clockwise tangent: east of the radial direction.
    v = [(r1[1] / m1) * speed, (-r1[0] / m1) * speed];
  }
  for (let it = 0; it < 40; it++) {
    const end = propagateKepler({ r: r1, v }, mu, tof);
    const ex = end.r[0] - r2[0];
    const ey = end.r[1] - r2[1];
    if (Math.hypot(ex, ey) < tolM) {
      // Clockwise motion only (angular momentum negative).
      if (r1[0] * v[1] - r1[1] * v[0] >= 0) return null;
      return { v1: [v[0], v[1]], v2: end.v };
    }
    // Finite-difference Jacobian of the arrival position w.r.t. the departure velocity.
    const h = Math.max(1e-3, Math.hypot(v[0], v[1]) * 1e-7);
    const ax = propagateKepler({ r: r1, v: [v[0] + h, v[1]] }, mu, tof).r;
    const ay = propagateKepler({ r: r1, v: [v[0], v[1] + h] }, mu, tof).r;
    const j11 = (ax[0] - end.r[0]) / h;
    const j21 = (ax[1] - end.r[1]) / h;
    const j12 = (ay[0] - end.r[0]) / h;
    const j22 = (ay[1] - end.r[1]) / h;
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    let dx = (-ex * j22 + ey * j12) / det;
    let dy = (ex * j21 - ey * j11) / det;
    // Damp large steps (keeps the iteration on the same transfer family).
    const speed = Math.hypot(v[0], v[1]);
    const step = Math.hypot(dx, dy);
    const maxStep = 0.2 * speed;
    if (step > maxStep) {
      dx *= maxStep / step;
      dy *= maxStep / step;
    }
    v = [v[0] + dx, v[1] + dy];
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
  }
  return null;
}

/** Signed specific angular momentum r × v (negative for clockwise motion). */
export const angularMomentum = (r: Vec2, v: Vec2) => r[0] * v[1] - r[1] * v[0];

/** Hyperbolic excess speed (m/s) of (r, v) about `mu`, or 0 for a bound orbit. */
export function excessSpeed(r: Vec2, v: Vec2, mu: number): number {
  const e = (v[0] * v[0] + v[1] * v[1]) / 2 - mu / Math.hypot(r[0], r[1]);
  return e > 0 ? Math.sqrt(2 * e) : 0;
}

/** Outgoing asymptote direction (unit vector) of a hyperbola, or null for a bound orbit. */
export function outgoingAsymptote(r: Vec2, v: Vec2, mu: number): Vec2 | null {
  const rMag = Math.hypot(r[0], r[1]);
  const v2 = v[0] * v[0] + v[1] * v[1];
  const energy = v2 / 2 - mu / rMag;
  if (energy <= 0) return null;
  const k = v2 - mu / rMag;
  const rv = r[0] * v[0] + r[1] * v[1];
  const ev: Vec2 = [(k * r[0] - rv * v[0]) / mu, (k * r[1] - rv * v[1]) / mu];
  const e = Math.hypot(ev[0], ev[1]);
  const nuInf = Math.acos(-1 / e);
  // Clockwise motion advances the ground angle: the asymptote lies nuInf past periapsis.
  const sense = angularMomentum(r, v) < 0 ? 1 : -1;
  const peri = Math.atan2(ev[0], ev[1]);
  const a = peri + sense * nuInf;
  return [Math.sin(a), Math.cos(a)];
}

/** Periapsis radius of the conic through (r, v) about `mu`. */
export function periapsisRadius(r: Vec2, v: Vec2, mu: number): number {
  const rMag = Math.hypot(r[0], r[1]);
  const v2 = v[0] * v[0] + v[1] * v[1];
  const k = v2 - mu / rMag;
  const rv = r[0] * v[0] + r[1] * v[1];
  const e = Math.hypot((k * r[0] - rv * v[0]) / mu, (k * r[1] - rv * v[1]) / mu);
  const h = angularMomentum(r, v);
  return (h * h) / mu / (1 + e);
}
