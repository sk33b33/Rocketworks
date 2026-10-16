import { describe, expect, it } from 'vitest';
import {
  burnTimeS,
  clampNode,
  NODE_LIMITS,
  nodeDeltaV,
  nodeTimes,
  pitchAlong,
  planNode,
  propagate,
} from '../src/flight/maneuver';
import {
  len,
  localFrame,
  orbitalElements,
  surfacePoint,
  visVivaSpeed,
  type Vec2,
} from '../src/flight/orbitMath';
import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../src/simulation/constants';

const R0 = EARTH_RADIUS_M + 200_000;

/** A circular orbit at 200 km, moving the way the game's orbits go (clockwise, eastward). */
function circular(radius = R0, angle = 0): { r: Vec2; v: Vec2 } {
  const r = surfacePoint(angle, radius - EARTH_RADIUS_M);
  const f = localFrame(r);
  const s = visVivaSpeed(radius, radius, radius);
  return { r, v: [f.east[0] * s, f.east[1] * s] };
}

/** Reference: small-step RK4 two-body integration. */
function integrate(r: Vec2, v: Vec2, t: number): { r: Vec2; v: Vec2 } {
  const acc = (p: number[]) => {
    const d = Math.hypot(p[0]!, p[1]!);
    const k = -EARTH_MU_M3S2 / (d * d * d);
    return [p[0]! * k, p[1]! * k];
  };
  let p = [...r];
  let q = [...v];
  const n = Math.ceil(t / 1);
  const h = t / n;
  for (let i = 0; i < n; i++) {
    const a1 = acc(p);
    const p2 = [p[0]! + (q[0]! * h) / 2, p[1]! + (q[1]! * h) / 2];
    const q2 = [q[0]! + (a1[0]! * h) / 2, q[1]! + (a1[1]! * h) / 2];
    const a2 = acc(p2);
    const p3 = [p[0]! + (q2[0]! * h) / 2, p[1]! + (q2[1]! * h) / 2];
    const q3 = [q[0]! + (a2[0]! * h) / 2, q[1]! + (a2[1]! * h) / 2];
    const a3 = acc(p3);
    const p4 = [p[0]! + q3[0]! * h, p[1]! + q3[1]! * h];
    const q4 = [q[0]! + a3[0]! * h, q[1]! + a3[1]! * h];
    const a4 = acc(p4);
    p = [0, 1].map((i) => p[i]! + (h / 6) * (q[i]! + 2 * q2[i]! + 2 * q3[i]! + q4[i]!));
    q = [0, 1].map((i) => q[i]! + (h / 6) * (a1[i]! + 2 * a2[i]! + 2 * a3[i]! + a4[i]!));
  }
  return { r: [p[0]!, p[1]!], v: [q[0]!, q[1]!] };
}

describe('manoeuvre planning', () => {
  it('propagates an orbit like a numerical integration, and closes after one period', () => {
    // An eccentric orbit: 200 km circular plus 300 m/s prograde.
    const c = circular();
    const s = len(c.v);
    const v: Vec2 = [(c.v[0] / s) * (s + 300), (c.v[1] / s) * (s + 300)];
    const el = orbitalElements(c.r, v);
    for (const t of [600, 2_000, el.periodS * 0.77]) {
      const k = propagate(c.r, v, t)!;
      const n = integrate(c.r, v, t);
      expect(Math.hypot(k.r[0] - n.r[0], k.r[1] - n.r[1])).toBeLessThan(50);
      expect(Math.hypot(k.v[0] - n.v[0], k.v[1] - n.v[1])).toBeLessThan(0.1);
    }
    const back = propagate(c.r, v, el.periodS)!;
    expect(Math.hypot(back.r[0] - c.r[0], back.r[1] - c.r[1])).toBeLessThan(1);
    // Escape trajectories aren't propagated.
    expect(propagate(c.r, [v[0] * 2, v[1] * 2], 100)).toBeNull();
  });

  it('points prograde at 0°, radial out at 90° and retrograde at 180°', () => {
    const c = circular(R0, 1.2);
    const f = localFrame(c.r);
    expect(pitchAlong(c.r, c.v)).toBeCloseTo(0, 6);
    expect(pitchAlong(c.r, f.up)).toBeCloseTo(90, 6);
    expect(Math.abs(pitchAlong(c.r, [-c.v[0], -c.v[1]]))).toBeCloseTo(180, 6);
  });

  it('predicts a Hohmann raise: a prograde burn lifts the far side of the orbit', () => {
    const c = circular();
    const rA = EARTH_RADIUS_M + 600_000;
    const dv = visVivaSpeed(R0, rA, R0) - len(c.v);
    const plan = planNode(c.r, c.v, 0, { tS: 900, progradeMS: dv, radialMS: 0 })!;
    expect(plan.dvMS).toBeCloseTo(dv, 6);
    expect(plan.elements.apoapsisAltM).toBeCloseTo(600_000, -3);
    expect(plan.elements.periapsisAltM).toBeCloseTo(200_000, -3);
    // A retrograde burn lowers it; a radial burn rotates the orbit without much size change.
    const down = planNode(c.r, c.v, 0, { tS: 900, progradeMS: -60, radialMS: 0 })!;
    expect(down.elements.periapsisAltM).toBeLessThan(100_000);
    const radial = planNode(c.r, c.v, 0, { tS: 900, progradeMS: 0, radialMS: 50 })!;
    expect(radial.elements.semiMajorAxisM).toBeCloseTo(
      orbitalElements(c.r, c.v).semiMajorAxisM,
      -4,
    );
    expect(radial.elements.eccentricity).toBeGreaterThan(0.004);
  });

  it('builds the Δv vector from prograde and radial parts', () => {
    const c = circular();
    const dv = nodeDeltaV(c, { tS: 0, progradeMS: 30, radialMS: 40 });
    expect(len(dv)).toBeCloseTo(50);
    expect(pitchAlong(c.r, dv)).toBeCloseTo((Math.atan2(40, 30) * 180) / Math.PI, 6);
  });

  it('estimates burn time with the rocket equation and keeps nodes within limits', () => {
    // 100 t, 1 MN, 3.5 km/s exhaust: about 0.33 s per m/s at first.
    const t = burnTimeS(100, 100_000, 1_000_000, 3_500);
    expect(t).toBeGreaterThan(9.7);
    expect(t).toBeLessThan(10);
    expect(burnTimeS(0, 1, 1, 1)).toBe(0);
    expect(burnTimeS(10, 1, 0, 1)).toBe(Infinity);
    const n = clampNode({ tS: 5, progradeMS: 9_999, radialMS: -9_999 }, 0, 5_400);
    expect(n).toEqual({
      tS: NODE_LIMITS.minLeadS,
      progradeMS: NODE_LIMITS.maxComponentMS,
      radialMS: -NODE_LIMITS.maxComponentMS,
    });
    expect(clampNode({ tS: 1e9, progradeMS: 0, radialMS: 0 }, 0, 5_400).tS).toBe(
      5_400 * NODE_LIMITS.maxOrbitsAhead,
    );
  });

  it('offers the next apoapsis and periapsis as node times', () => {
    const c = circular();
    expect(nodeTimes(c.r, c.v, 100)).toEqual({ apoS: null, periS: null });
    const s = len(c.v);
    const v: Vec2 = [(c.v[0] / s) * (s + 100), (c.v[1] / s) * (s + 100)];
    const { apoS, periS } = nodeTimes(c.r, v, 100);
    const el = orbitalElements(c.r, v);
    // Just burned at periapsis: apoapsis half an orbit on, the next periapsis a full orbit on.
    expect(apoS! - 100).toBeCloseTo(el.periodS / 2, -1);
    expect(periS! - 100).toBeCloseTo(el.periodS, -1);
    const atApo = propagate(c.r, v, apoS! - 100)!;
    expect(len(atApo.r) - EARTH_RADIUS_M).toBeCloseTo(el.apoapsisAltM, -2);
  });
});
