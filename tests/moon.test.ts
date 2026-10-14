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
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { FlightRuntime } from '../src/flight/flightRuntime';
import { NO_PROGRESS, objectivesFor, orbitalGoalsMet } from '../src/flight/flightOutcome';
import type { FlightRecord } from '../src/launch/flightRecord';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';
import { NO_LUNAR_PROGRESS, type LunarMissionPlan } from '../src/moon/lunarFlight';
import { findLunarSite, SiteTerrain } from '../src/moon/lunarSites';
import { surfaceProgress, surfaceTasks } from '../src/moon/lunarLanding';
import { gradeAtLeast } from '../src/recovery/rating';
import {
  checkLegs,
  defaultRefuel,
  DEPOT_TOPUP_CREDITS,
  FLYBY_RULES,
  LANDING_RULES,
  NO_REFUEL,
  refuelCost,
  TANKER_FLIGHT_CREDITS,
  tankerFlights,
} from '../src/moon/lunarRules';

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
    const e: GravityEnv = { ...env, terrain: { heightAt: () => 0, slopeAt: () => slopeDeg } };
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

describe('Moon missions', () => {
  const NOW = '2026-01-01T00:00:00.000Z';

  function lunarContext(missionId: string, plan: LunarMissionPlan) {
    const bp = createCompleteStarterDesign(NOW);
    const vehicle = deriveFlightVehicle(bp, 300);
    const lc: LaunchContext = {
      outcome: {
        id: 'f1',
        at: NOW,
        missionId,
        missionName: 'Moon',
        designId: bp.id,
        designName: bp.name,
        crewed: true,
      },
      blueprint: bp,
      designRevision: bp.revision,
      crewed: true,
      crewNames: ['A', 'B'],
      config: {
        vehicle,
        target: { kind: 'orbit', altitudeM: 150_000 },
        failures: [],
        boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION.platform,
      },
    };
    const asc = simulateAscent(lc.config, SIM_DT_S);
    return flightContextFromLaunch(lc, asc, null, undefined, plan);
  }

  function runtime(missionId: string, plan: LunarMissionPlan) {
    const records: FlightRecord[] = [];
    const rt = new FlightRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.start(lunarContext(missionId, plan));
    const frames = (n: number, until: () => boolean) => {
      for (let i = 0; i < n && !until(); i++) {
        if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
        rt.update(0.1);
      }
    };
    return { rt, records, frames };
  }

  it('refuels in orbit only when bought and only in a low orbit', () => {
    const { rt, frames } = runtime('lunar-transfer', {
      goal: 'flyby',
      landing: false,
      refuel: { leo: false, depot: false },
    });
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(false);
    expect(rt.engage('lunar-orbit').ok).toBe(false);
    expect(rt.engage('trans-earth').ok).toBe(false);
  });

  it('flies a credited lunar flyby: refuel, injection, free return, aerocapture and landing', () => {
    const { rt, records, frames } = runtime('lunar-transfer', {
      goal: 'flyby',
      landing: false,
      refuel: { leo: true, depot: false },
    });
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.lunar?.refuelLeo);
    expect(rt.current.state!.propKg).toBeGreaterThan(1_000_000);
    expect(rt.engage('translunar').ok).toBe(true);
    frames(400_000, () => rt.current.program.program === 'none');
    const l = rt.current.progress.lunar!;
    expect(l).toMatchObject({ tli: true, flyby: true, earthReturn: true });
    expect(rt.current.maxWarp).toBeLessThanOrEqual(1000);
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'success', credited: true, crewSafe: true });
    expect(records[0]?.lunar?.flyby).toBe(true);
    expect(records[0]?.landing?.outcome).toBe('landed');
  }, 60_000);
});

describe('Moon mission rules', () => {
  it('checks each leg against the refuelling bought', () => {
    const none = checkLegs(LANDING_RULES, NO_REFUEL, 7_400, 1_200);
    expect(none.map((c) => c.ok)).toEqual([false, false]);
    const both = checkLegs(LANDING_RULES, { leo: true, depot: true }, 7_400, 1_200);
    expect(both.map((c) => c.ok)).toEqual([true, true]);
    const leoOnly = checkLegs(LANDING_RULES, { leo: true, depot: false }, 7_400, 1_200);
    expect(leoOnly[1]!.availableMS).toBeCloseTo(7_400 - 4_250, 0);
    expect(leoOnly[1]!.ok).toBe(false);
    expect(refuelCost({ leo: true, depot: true }, 1_070_000)).toBe(
      tankerFlights(1_070_000) * TANKER_FLIGHT_CREDITS + DEPOT_TOPUP_CREDITS,
    );
    expect(defaultRefuel(FLYBY_RULES)).toEqual({ leo: true, depot: false });
  });

  it('lists lunar objectives and credits only completed Moon goals', () => {
    expect(objectivesFor('lunar-transfer', { leo: true, depot: false })).toEqual([
      'orbit',
      'refuel',
      'tli',
      'flyby',
      'earth-return',
      'deorbit',
      'reentry',
      'landing',
    ]);
    expect(objectivesFor('lunar-landing', { leo: true, depot: true })).toContain('surface');
    const base = { ...NO_LUNAR_PROGRESS, tli: true, flyby: true };
    expect(orbitalGoalsMet('lunar-transfer', { ...NO_PROGRESS, lunar: base })).toBe(false);
    expect(
      orbitalGoalsMet('lunar-transfer', { ...NO_PROGRESS, lunar: { ...base, earthReturn: true } }),
    ).toBe(true);
    expect(
      orbitalGoalsMet('lunar-landing', { ...NO_PROGRESS, lunar: { ...base, earthReturn: true } }),
    ).toBe(false);
  });
});

describe('lunar landing', () => {
  const NOW = '2026-01-01T00:00:00.000Z';
  const plan: LunarMissionPlan = {
    goal: 'capture',
    landing: true,
    refuel: { leo: true, depot: true },
  };

  /** Flies from launch to a full-tank lunar orbit at the depot. */
  function toLunarOrbit(site: string) {
    const bp = createCompleteStarterDesign(NOW);
    const vehicle = deriveFlightVehicle(bp, 300);
    const lc: LaunchContext = {
      outcome: {
        id: 'f1',
        at: NOW,
        missionId: 'lunar-landing',
        missionName: 'Landing',
        designId: bp.id,
        designName: bp.name,
        crewed: true,
      },
      blueprint: bp,
      designRevision: bp.revision,
      crewed: true,
      crewNames: ['A', 'B'],
      config: {
        vehicle,
        target: { kind: 'orbit', altitudeM: 150_000 },
        failures: [],
        boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION.platform,
      },
    };
    const ctx = flightContextFromLaunch(
      lc,
      simulateAscent(lc.config, SIM_DT_S),
      null,
      undefined,
      plan,
    );
    const records: FlightRecord[] = [];
    const rt = new FlightRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.start(ctx);
    const frames = (n: number, until: () => boolean) => {
      for (let i = 0; i < n && !until(); i++) {
        if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
        rt.update(0.1);
      }
    };
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    rt.refuel();
    frames(50_000, () => !!rt.current.progress.lunar?.refuelLeo);
    rt.engage('translunar');
    frames(400_000, () => rt.current.program.program === 'none');
    expect(rt.current.progress.lunar?.lunarOrbit).toBe(true);
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.lunar?.refuelDepot);
    expect(rt.setLunarSite(site).ok).toBe(true);
    return { rt, records, frames };
  }

  it('lands with the assist, works on the surface, lifts off and comes home for credit', () => {
    const { rt, records, frames } = toLunarOrbit('aurora-highlands');
    expect(rt.engage('lunar-descent').ok).toBe(true);
    frames(400_000, () => rt.current.phase !== 'flight');
    expect(rt.current.phase).toBe('surface');
    expect(rt.setLunarSite('sea-of-calm').ok).toBe(false);
    const landing = rt.current.progress.lunar!.landing!;
    expect(landing).toMatchObject({ outcome: 'landed', manual: false });
    expect(gradeAtLeast(landing.grade, 'B')).toBe(true);
    frames(100_000, () => !!rt.current.progress.lunar?.surfaceDone);
    expect(rt.liftOff().ok).toBe(true);
    frames(100_000, () => rt.current.program.program === 'none');
    expect(rt.current.progress.lunar?.ascent).toBe(true);
    expect(rt.engage('trans-earth').ok).toBe(true);
    frames(400_000, () => rt.current.program.program === 'none');
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'success', credited: true, crewSafe: true });
    expect(records[0]?.lunar?.landing?.siteId).toBe('aurora-highlands');
  }, 120_000);

  it('credits a manual landing when the player flies the last 500 m', () => {
    const { rt, frames } = toLunarOrbit('sea-of-calm');
    rt.engage('lunar-descent');
    frames(400_000, () => (rt.current.lunar?.geometry?.radarM ?? Infinity) < 700);
    rt.setMode('retrograde');
    for (let i = 0; i < 20_000 && rt.current.phase === 'flight'; i++) {
      const geo = rt.current.lunar!.geometry!;
      const speed = Math.hypot(geo.vx, geo.vh);
      const final = geo.radarM < 15 && speed < 3;
      if (final) rt.setMode('vertical');
      const vt = Math.max(1, Math.min(60, Math.sqrt(1.8 * Math.max(0, geo.radarM - 2))));
      const a = final
        ? geo.gEff + (-1.2 - geo.vh) * 1.5
        : geo.gEff * (-geo.vh / Math.max(0.5, speed)) + (speed - vt) * 0.8;
      rt.setThrottle(Math.max(0, Math.min(1, a / 4)));
      rt.update(0.05);
    }
    expect(rt.current.phase).toBe('surface');
    expect(rt.current.progress.lunar?.landing).toMatchObject({ outcome: 'landed', manual: true });
  }, 120_000);
});

describe('lunar sites', () => {
  it('builds deterministic terrain whose hazards match the site rating', () => {
    const calm = new SiteTerrain(findLunarSite('sea-of-calm')!);
    const rim = new SiteTerrain(findLunarSite('kestrel-rim')!);
    expect(calm.heightAt(123)).toBe(new SiteTerrain(findLunarSite('sea-of-calm')!).heightAt(123));
    const steep = (t: SiteTerrain) => {
      let n = 0;
      for (let x = -500; x <= 500; x += 4) if (t.slopeAt(x) > 10) n++;
      return n / 251;
    };
    expect(calm.slopeAt(0)).toBeLessThan(5);
    expect(steep(calm)).toBeLessThan(steep(rim));
    const best = rim.safestNear(0, 400);
    expect(best.slopeDeg).toBeLessThan(rim.slopeAt(0));
  });

  it('gates the surface tasks on safing and finishes them all', () => {
    const tasks = surfaceTasks(findLunarSite('sea-of-calm')!, true);
    expect(tasks.map((t) => t.id)).toEqual(['safing', 'survey', 'samples', 'experiments']);
    expect(
      surfaceProgress(tasks, 1_800)
        .slice(1)
        .every((p) => p === 0),
    ).toBe(true);
    expect(surfaceProgress(tasks, 1_800 + 3 * 3_600).every((p) => p === 1)).toBe(true);
  });
});
