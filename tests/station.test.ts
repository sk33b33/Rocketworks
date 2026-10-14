import { describe, expect, it } from 'vitest';
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { evaluateFlight, NO_PROGRESS, objectivesFor } from '../src/flight/flightOutcome';
import { initialFlightState } from '../src/flight/flightModel';
import { FlightRuntime } from '../src/flight/flightRuntime';
import { findZone } from '../src/flight/landingZones';
import { surfacePoint } from '../src/flight/orbitMath';
import type { FlightRecord } from '../src/launch/flightRecord';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { EARTH_MU_M3S2, SIM_DT_S } from '../src/simulation/constants';
import {
  approachMetrics,
  assistControls,
  DOCK_WINDOW,
  initialProxState,
  insideStation,
  NO_CONTROLS,
  PORT,
  stepProximity,
  stationTasks,
  taskProgress,
  undock,
  type ProxState,
} from '../src/station/proximity';
import { cwTargetVelocity, transferPhase } from '../src/station/rendezvous';
import {
  fromStationFrame,
  STATION_N,
  STATION_RADIUS_M,
  stationState,
  toStationFrame,
} from '../src/station/stationOrbit';

const NOW = '2026-01-01T00:00:00.000Z';
const eph = { angle0: 0.3, t0: 0 };

describe('station frame', () => {
  it('converts to and from the station frame exactly', () => {
    const st = stationState(eph, 120);
    const rel = { p: [-150, 2_000, 0] as const, v: [0.4, -1.2, 0] as const };
    const { r, v } = fromStationFrame(st, rel);
    const back = toStationFrame(st, r, v);
    expect(back.p[0]).toBeCloseTo(-150, 6);
    expect(back.p[1]).toBeCloseTo(2_000, 6);
    expect(back.v[0]).toBeCloseTo(0.4, 6);
    expect(back.v[1]).toBeCloseTo(-1.2, 6);
    expect(Math.hypot(...st.r)).toBeCloseTo(STATION_RADIUS_M, 0);
  });

  it('matches two-body motion with the Clohessy–Wiltshire model near the station', () => {
    const st0 = stationState(eph, 0);
    const { r, v } = fromStationFrame(st0, { p: [-200, 0, 0], v: [0, 0, 0] });
    let rr: [number, number] = [r[0], r[1]];
    let vv: [number, number] = [v[0], v[1]];
    let [x, y, vx, vy] = [-200, 0, 0, 0];
    const dt = 0.002;
    for (let i = 0; i < 300 / dt; i++) {
      const k = -EARTH_MU_M3S2 / Math.hypot(...rr) ** 3;
      vv = [vv[0] + k * rr[0] * dt, vv[1] + k * rr[1] * dt];
      rr = [rr[0] + vv[0] * dt, rr[1] + vv[1] * dt];
      const n = STATION_N;
      const ax = 3 * n * n * x + 2 * n * vy;
      const ay = -2 * n * vx;
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;
    }
    const full = toStationFrame(stationState(eph, 300), rr, vv);
    expect(Math.abs(full.p[0] - x)).toBeLessThan(5);
    expect(Math.abs(full.p[1] - y)).toBeLessThan(5);
  });

  it('targets a point with the CW transfer solution', () => {
    const T = 900;
    const [vx0, vy0] = cwTargetVelocity([500, -8_000], [0, 2_000], T);
    let [x, y, vx, vy] = [500, -8_000, vx0, vy0];
    const n = STATION_N;
    for (let t = 0; t < T; t += 0.01) {
      const ax = 3 * n * n * x + 2 * n * vy;
      const ay = -2 * n * vx;
      vx += ax * 0.01;
      vy += ay * 0.01;
      x += vx * 0.01;
      y += vy * 0.01;
    }
    expect(Math.hypot(x, y - 2_000)).toBeLessThan(20);
    expect(transferPhase(STATION_RADIUS_M - 150_000)).toBeGreaterThan(0);
  });
});

describe('proximity operations', () => {
  const fly = (
    s0: ProxState,
    steps: number,
    control = (s: ProxState) => assistControls(s, 'dock'),
  ) => {
    let s = s0;
    for (let i = 0; i < steps && s.phase === 'free'; i++)
      s = stepProximity(s, control(s), 0.05, false);
    return s;
  };

  it('docks with the assist from the hold point, inside the window', () => {
    const s = fly(initialProxState([300, 2_000, 0], [1, 0.5, 0], 0), 400_000);
    expect(s.phase).toBe('docked');
    expect(s.docking?.closingMS).toBeLessThanOrEqual(DOCK_WINDOW.maxClosingMS);
    expect(s.docking?.grade).toBeTruthy();
    expect(s.rcsLeftMS).toBeGreaterThan(10);
    expect(s.violations).toBe(0);
  });

  it('bounces off when misaligned and collides when too fast', () => {
    const near = (closing: number, att = { pitch: 0, yaw: 0, roll: 0 }): ProxState => ({
      ...initialProxState([PORT[0], PORT[1] + 0.2, PORT[2]], [0, -closing, 0], 0),
      att,
    });
    const coast = (s: ProxState) => {
      let x = s;
      for (let i = 0; i < 400 && x.phase === 'free' && x.bounces + x.collisions === 0; i++)
        x = stepProximity(x, { ...NO_CONTROLS, hold: false }, 0.05);
      return x;
    };
    expect(coast(near(0.1)).phase).toBe('docked');
    expect(coast(near(0.1, { pitch: 8, yaw: 0, roll: 0 })).bounces).toBe(1);
    const crash = coast(near(1.6));
    expect(crash.collisions).toBe(1);
    expect(crash.hull).toBeLessThan(0.7);
    expect(insideStation([0, 0, 0])).toBe(true);
    expect(insideStation([0, 300, 0])).toBe(false);
  });

  it('flags corridor and speed violations inside the keep-out sphere', () => {
    let s = initialProxState([60, 120, 0], [0, -1, 0], 0);
    s = stepProximity(s, { ...NO_CONTROLS }, 0.05);
    expect(s.violations).toBe(1);
    expect(approachMetrics(s).inKeepOut).toBe(true);
  });

  it('gates undocking on the docked tasks', () => {
    const tasks = stationTasks(2, true);
    expect(tasks.map((t) => t.id)).toEqual(['leak-check', 'experiment', 'crew', 'cargo']);
    expect(taskProgress(tasks, 1_800).every((p, i) => (i === 0 ? p === 1 : p === 0))).toBe(true);
    expect(taskProgress(tasks, 1_800 + 4 * 3_600).every((p) => p === 1)).toBe(true);
    const docked = fly(initialProxState([0, 80, 0], [0, 0, 0], 0), 100_000);
    const away = undock(docked);
    expect(away.phase).toBe('free');
    expect(away.v[1]).toBeGreaterThan(0);
  });
});

describe('station mission end to end', () => {
  const bp = createCompleteStarterDesign(NOW);
  function launchContext(payloadKg: number): LaunchContext {
    const vehicle = deriveFlightVehicle(bp, payloadKg);
    return {
      outcome: {
        id: 'f1',
        at: NOW,
        missionId: 'station-docking',
        missionName: 'Rotation',
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
  }

  it('rendezvous, docks, runs the tasks, departs and lands for credit', () => {
    const lc = launchContext(300);
    const asc = simulateAscent(lc.config, SIM_DT_S);
    const base = flightContextFromLaunch(lc, asc, null, { crew: 2, cargo: false });
    const ctx = { ...base, spec: { ...base.spec, hasDockingAdapter: true } };
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
    expect(rt.engage('rendezvous').ok).toBe(true);
    frames(200_000, () => rt.proximityAvailability().ok);
    expect(rt.beginProximity().ok).toBe(true);
    expect(rt.current.progress.rendezvous).toBe(true);
    rt.setProxAssist('dock');
    frames(200_000, () => rt.current.proximity?.state.phase === 'docked');
    expect(rt.current.proximity?.state.docking?.grade).toBeTruthy();
    frames(100_000, () => !!rt.current.proximity?.canUndock);
    rt.undock();
    rt.setProxAssist('abort');
    frames(100_000, () => !!rt.current.proximity?.canDepart);
    expect(rt.depart().ok).toBe(true);
    expect(rt.current.phase).toBe('flight');
    expect(rt.current.progress.docking?.tasksDone).toBe(true);
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: 'success', credited: true, crewSafe: true });
    expect(records[0]?.docking?.tasksDone).toBe(true);
  });

  it('defines the station objectives and only credits a completed docking', () => {
    expect(objectivesFor('station-docking')).toContain('dock');
    expect(objectivesFor('orbital-flight')).toContain('lap');
    const zone = findZone('rtls')!;
    const landed = {
      ...initialFlightState(surfacePoint(zone.groundAngle), [0, 0], 1_000),
      phase: 'landed' as const,
    };
    const ctx = {
      outcome: {
        id: 'f',
        at: NOW,
        missionId: 'station-docking',
        missionName: 'R',
        designId: 'd',
        designName: 'D',
        crewed: true,
      },
      zone,
      ascent: { maxAltitudeM: 1, maxSpeedMS: 1, maxQPa: 1, events: [] },
      maxAltitudeM: 1,
      maxSpeedMS: 1,
    };
    const docked = {
      grade: 'A' as const,
      manual: false,
      bounces: 0,
      collisions: 0,
      violations: 0,
      tasksDone: true,
    };
    expect(
      evaluateFlight(ctx, landed, { ...NO_PROGRESS, orbit: true, docking: docked }, NOW).credited,
    ).toBe(true);
    expect(
      evaluateFlight(ctx, landed, { ...NO_PROGRESS, orbit: true, travelSinceOrbit: 9 }, NOW),
    ).toMatchObject({ credited: false, result: 'partial' });
  });
});
