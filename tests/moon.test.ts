import { describe, expect, it } from 'vitest';
import {
  initialFlightState,
  noseDirection,
  stepFlight,
  type FlightState,
  type ShipSpec,
} from '../src/flight/flightModel';
import { orbitalElements } from '../src/flight/orbitMath';
import {
  bodyFrame,
  gravityAccel,
  MOON_DISTANCE_M,
  MOON_N,
  MOON_RADIUS_M,
  MOON_SOI_M,
  moonState,
  selenoAngle,
  surfaceState,
  type GravityEnv,
} from '../src/moon/moonOrbit';
import { coastDt, coastStep, propagate, predictLunarPass } from '../src/moon/propagate';
import { MOON_BODY, planTli, timeToPeriapsis } from '../src/moon/lunarTransfer';
import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../src/simulation/constants';
import { MOON_MU_M3S2 } from '../src/moon/moonOrbit';

const env: GravityEnv = { moon: { angle0: 1, t0: 0 } };
const spec: ShipSpec = {
  stage: {
    dryMassKg: 140_000,
    propellantKg: 1_070_000,
    engineCount: 6,
    thrustSlPerEngineN: 4.5e6,
    thrustVacPerEngineN: 4.77e6,
    ispSlS: 330,
    ispVacS: 350,
  },
  shieldCoverage: 1,
  hasFlaps: true,
  lengthM: 50,
  radiusM: 4.5,
};
const coastControls = (s: FlightState) => ({
  targetPitchDeg: s.pitchDeg,
  bankDeg: 0,
  yawDeg: 0,
  throttle: 0,
  slewDegS: 8,
});

/** A ship in a circular orbit around the Moon at `altM`, clockwise (the game's prograde). */
function lunarOrbitState(altM: number, tS = 0): FlightState {
  const m = moonState(env.moon, tS);
  const d = MOON_RADIUS_M + altM;
  const vc = Math.sqrt(MOON_MU_M3S2 / d);
  // Above the Moon's far side: up = away from Earth.
  const up = [m.r[0] / MOON_DISTANCE_M, m.r[1] / MOON_DISTANCE_M];
  const east = [up[1]!, -up[0]!];
  const s = initialFlightState(
    [m.r[0] + up[0]! * d, m.r[1] + up[1]! * d],
    [m.v[0] + east[0]! * vc, m.v[1] + east[1]! * vc],
    100_000,
    tS,
  );
  return { ...s, ref: 'moon', pitchDeg: 0 };
}

describe('Moon model', () => {
  it('moves the Moon on a circular orbit with a ~27-day period', () => {
    const a = moonState(env.moon, 0);
    const b = moonState(env.moon, 86_400 * 3);
    expect(Math.hypot(...a.r)).toBeCloseTo(MOON_DISTANCE_M, -2);
    expect(Math.hypot(...b.r)).toBeCloseTo(MOON_DISTANCE_M, -2);
    expect((2 * Math.PI) / MOON_N / 86_400).toBeCloseTo(27.3, 0);
    expect(MOON_SOI_M / 1000).toBeGreaterThan(60_000);
    expect(MOON_SOI_M / 1000).toBeLessThan(70_000);
  });

  it('includes the Moon in gravity only on lunar missions', () => {
    const r: [number, number] = [0, EARTH_RADIUS_M + 400_000];
    const plain = gravityAccel(r, 0);
    const lunar = gravityAccel(r, 0, env);
    expect(Math.hypot(plain[0] - lunar[0], plain[1] - lunar[1])).toBeLessThan(1e-5);
    // Near the Moon its pull dominates.
    const m = moonState(env.moon, 0);
    const near: [number, number] = [m.r[0] * 1.001, m.r[1] * 1.001];
    const a = gravityAccel(near, 0, env);
    expect(Math.hypot(...a)).toBeGreaterThan(0.5);
  });

  it('turns surface points with the Moon (synchronous rotation)', () => {
    const p = surfaceState(0.3, 1_000, env.moon);
    expect(selenoAngle(p.r, 1_000, env.moon)).toBeCloseTo(0.3, 6);
    const m = moonState(env.moon, 1_000);
    const rel = Math.hypot(p.v[0] - m.v[0], p.v[1] - m.v[1]);
    expect(rel).toBeCloseTo(MOON_N * MOON_RADIUS_M, 3);
  });

  it('keeps a low lunar orbit stable at the coasting step', () => {
    let s = lunarOrbitState(100_000);
    const el0 = orbitalElements(
      bodyFrame('moon', s.r, s.v, s.tS, env).r,
      bodyFrame('moon', s.r, s.v, s.tS, env).v,
      MOON_BODY,
    );
    expect(el0.status).toBe('orbit');
    while (s.tS < 86_400) s = stepFlight(s, spec, coastControls(s), coastDt(s.r, s.tS, env), env);
    const f = bodyFrame('moon', s.r, s.v, s.tS, env);
    expect(s.phase).toBe('flight');
    expect(Math.abs(f.altitudeM - 100_000)).toBeLessThan(15_000);
  });

  it('switches the attitude reference at the sphere of influence without moving the nose', () => {
    const m = moonState(env.moon, 0);
    // Just outside the sphere of influence, falling toward the Moon.
    const u = [m.r[0] / MOON_DISTANCE_M, m.r[1] / MOON_DISTANCE_M];
    const d = MOON_SOI_M + 50;
    const s0 = initialFlightState(
      [m.r[0] - u[0]! * d, m.r[1] - u[1]! * d],
      [m.v[0] + u[0]! * 1_000, m.v[1] + u[1]! * 1_000],
      1_000,
    );
    const before = noseDirection(s0.r, s0.pitchDeg);
    let s1 = s0;
    for (let i = 0; i < 3 && s1.ref !== 'moon'; i++)
      s1 = stepFlight(s1, spec, coastControls(s1), 1, env);
    expect(s1.ref).toBe('moon');
    const after = noseDirection(s1.r, s1.pitchDeg, bodyFrame('moon', s1.r, s1.v, s1.tS, env).up);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeLessThan(0.01);
    expect(s1.events.some((e) => e.text.includes('sphere of influence'))).toBe(true);
  });

  it('propagates exactly like single coast steps', () => {
    const s = lunarOrbitState(100_000);
    const a = propagate({ r: s.r, v: s.v, tS: 0 }, env, 600).end;
    let b = { r: s.r, v: s.v, tS: 0 };
    while (b.tS < 600 - 1e-6) b = coastStep(b, Math.min(coastDt(b.r, b.tS, env), 600 - b.tS), env);
    expect(Math.hypot(a.r[0] - b.r[0], a.r[1] - b.r[1])).toBeLessThan(1);
  });

  it('computes the time to periapsis for ellipses and hyperbolas', () => {
    const rp = MOON_RADIUS_M + 100_000;
    for (const vp of [1_700, 2_400]) {
      // Start at periapsis and coast back in time by 300 s on the conic (numerically).
      let r: [number, number] = [0, rp];
      let v: [number, number] = [-vp, 0];
      for (let i = 0; i < 3_000; i++) {
        const k = -MOON_MU_M3S2 / Math.hypot(...r) ** 3;
        v = [v[0] + k * r[0] * 0.1, v[1] + k * r[1] * 0.1];
        r = [r[0] + v[0] * 0.1, r[1] + v[1] * 0.1];
      }
      // Reverse the velocity: now approaching periapsis, ~300 s away.
      expect(timeToPeriapsis(r, [-v[0], -v[1]], MOON_MU_M3S2)).toBeCloseTo(300, -1);
    }
  });
});

describe('lunar touchdown', () => {
  const descend = (vert: number, horiz: number, slopeDeg: number, pitchDeg = 90) => {
    const e: GravityEnv = { ...env, slopeAt: () => slopeDeg };
    const p = surfaceState(0.2, 0, e.moon, 1);
    const m = moonState(e.moon, 0);
    const up = [(p.r[0] - m.r[0]) / (MOON_RADIUS_M + 1), (p.r[1] - m.r[1]) / (MOON_RADIUS_M + 1)];
    const east = [up[1]!, -up[0]!];
    let s: FlightState = {
      ...initialFlightState(
        p.r,
        [p.v[0] - up[0]! * vert + east[0]! * horiz, p.v[1] - up[1]! * vert + east[1]! * horiz],
        10_000,
      ),
      ref: 'moon',
      pitchDeg,
    };
    for (let i = 0; i < 400 && s.phase === 'flight'; i++)
      s = stepFlight(s, spec, { ...coastControls(s), targetPitchDeg: pitchDeg }, 0.05, e);
    return s;
  };

  it('lands gently, tips over on steep ground and crashes when fast', () => {
    const ok = descend(1.5, 0.2, 3);
    expect(ok.phase).toBe('landed');
    expect(ok.touchdown?.body).toBe('moon');
    expect(descend(1.5, 0.2, 14).phase).toBe('tipped');
    expect(descend(1.5, 3, 2).phase).toBe('tipped');
    expect(descend(12, 0, 0).phase).toBe('crashed');
    const hard = descend(5, 0, 2);
    expect(hard.phase).toBe('landed');
    expect(hard.hull).toBeLessThan(1);
  });
});

describe('trans-lunar planning', () => {
  it('plans an injection that reaches the Moon within the transfer window', () => {
    const r0 = EARTH_RADIUS_M + 200_000;
    const vc = Math.sqrt(EARTH_MU_M3S2 / r0);
    const s = initialFlightState([0, r0], [vc, 0], 1_000_000);
    const plan = planTli(s, 'capture', env);
    expect(plan).not.toBeNull();
    expect(plan!.dvMS).toBeGreaterThan(3_000);
    expect(plan!.dvMS).toBeLessThan(3_250);
    // The impulsive version of the plan passes close to the Moon.
    let c = { r: s.r, v: s.v, tS: s.tS };
    while (c.tS < plan!.burnT - 1e-6)
      c = coastStep(c, Math.min(coastDt(c.r, c.tS, env), plan!.burnT - c.tS), env);
    const speed = Math.hypot(...c.v);
    const k = (speed + plan!.dvMS) / speed;
    const pass = predictLunarPass({ ...c, v: [c.v[0] * k, c.v[1] * k] }, env);
    expect(pass).not.toBeNull();
    expect(pass!.periAltM).toBeGreaterThan(20_000);
    expect(pass!.periAltM).toBeLessThan(400_000);
    expect(pass!.sense).toBe(1);
    expect((pass!.periT - s.tS) / 86_400).toBeLessThan(4.5);
  });
});
