import { describe, expect, it } from 'vitest';
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { FlightRuntime, type FlightContext } from '../src/flight/flightRuntime';
import type { LaunchContext } from '../src/launch/launchRuntime';
import type { LunarMissionPlan } from '../src/moon/lunarFlight';
import {
  checkRuntimeSnapshot,
  clearFlightSave,
  decodeJson,
  encodeJson,
  FLIGHT_SAVE_KEY,
  readFlightSave,
  writeFlightSave,
} from '../src/persistence/flightSave';
import { createMemoryStorage } from '../src/persistence/saveGame';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';

function context(missionId: string, lunar?: LunarMissionPlan): FlightContext {
  const bp = createCompleteStarterDesign(NOW);
  const vehicle = deriveFlightVehicle(bp, 300);
  const lc: LaunchContext = {
    outcome: {
      id: 'f1',
      at: NOW,
      missionId,
      missionName: 'Test',
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
    { crew: 2, cargo: false },
    lunar,
  );
  return { ...ctx, spec: { ...ctx.spec, hasDockingAdapter: true } };
}

const run = (rt: FlightRuntime, n: number, until: () => boolean = () => false) => {
  for (let i = 0; i < n && !until(); i++) {
    if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
    rt.update(0.1);
  }
};

/** Snapshot through JSON into a fresh runtime, then step both identically and compare. */
function expectExactResume(a: FlightRuntime, frames = 600) {
  const snap = a.snapshot();
  expect(snap).not.toBeNull();
  const b = new FlightRuntime(
    () => undefined,
    () => NOW,
  );
  b.restore(decodeJson(encodeJson(snap)) as typeof snap & object);
  expect(b.current.paused).toBe(true);
  expect(b.current.phase).toBe(a.current.phase);
  b.togglePause();
  for (let i = 0; i < frames; i++) {
    for (const rt of [a, b]) {
      rt.setWarp(Math.min(100, rt.current.maxWarp) as 100);
      rt.update(0.1);
    }
  }
  const sa = a.liveState!;
  const sb = b.liveState!;
  expect(sb.tS).toBe(sa.tS);
  expect(sb.r).toEqual(sa.r);
  expect(sb.v).toEqual(sa.v);
  expect(sb.propKg).toBe(sa.propKg);
  expect(b.current.progress).toEqual(a.current.progress);
  return b;
}

describe('flight save format', () => {
  it('round-trips infinities through JSON', () => {
    const v = decodeJson(encodeJson({ a: Infinity, b: -Infinity, c: [1, NaN] })) as {
      a: number;
      b: number;
      c: number[];
    };
    expect(v.a).toBe(Infinity);
    expect(v.b).toBe(-Infinity);
    expect(Number.isNaN(v.c[1])).toBe(true);
  });

  it('rejects damaged or foreign snapshots without throwing', () => {
    const storage = createMemoryStorage();
    expect(readFlightSave(storage).status).toBe('none');
    storage.setItem(FLIGHT_SAVE_KEY, '{oops');
    expect(readFlightSave(storage).status).toBe('corrupt');
    storage.setItem(FLIGHT_SAVE_KEY, JSON.stringify({ version: 99 }));
    expect(readFlightSave(storage).status).toBe('corrupt');
    storage.setItem(
      FLIGHT_SAVE_KEY,
      JSON.stringify({
        version: 1,
        kind: 'flight',
        savedAt: NOW,
        missionId: 'x',
        outcomeId: 'y',
        runtime: { v: 1, phase: 'flight' },
      }),
    );
    const bad = readFlightSave(storage);
    expect(bad.status).toBe('corrupt');
    expect(checkRuntimeSnapshot({ v: 2 })).toMatch(/format/);
    clearFlightSave(storage);
    expect(readFlightSave(storage).status).toBe('none');
  });

  it('stores and reads back a flight and an ascent marker', () => {
    const storage = createMemoryStorage();
    const rt = new FlightRuntime(() => undefined);
    rt.start(context('orbital-flight'));
    const snap = rt.snapshot()!;
    expect(
      writeFlightSave(storage, {
        version: 1,
        kind: 'flight',
        savedAt: NOW,
        missionId: 'orbital-flight',
        outcomeId: 'f1',
        runtime: snap,
      }).ok,
    ).toBe(true);
    const back = readFlightSave(storage);
    expect(back.status).toBe('ok');
    writeFlightSave(storage, {
      version: 1,
      kind: 'ascent',
      savedAt: NOW,
      missionId: 'orbital-flight',
      missionName: 'Shakedown',
    });
    const marker = readFlightSave(storage);
    expect(marker.status === 'ok' && marker.record.kind).toBe('ascent');
  });
});

describe('flight resume', () => {
  it('continues an Earth-orbit rendezvous exactly', () => {
    const a = new FlightRuntime(
      () => undefined,
      () => NOW,
    );
    a.start(context('station-docking'));
    run(a, 50_000, () => a.current.program.program === 'none' && a.current.progress.orbit);
    expect(a.engage('rendezvous').ok).toBe(true);
    run(a, 200);
    const b = expectExactResume(a);
    expect(b.current.program.program).toBe(a.current.program.program);
  });

  it('continues docked proximity operations exactly', () => {
    const a = new FlightRuntime(
      () => undefined,
      () => NOW,
    );
    a.start(context('station-docking'));
    run(a, 50_000, () => a.current.program.program === 'none' && a.current.progress.orbit);
    a.engage('rendezvous');
    run(a, 200_000, () => a.proximityAvailability().ok);
    expect(a.beginProximity().ok).toBe(true);
    a.setProxAssist('dock');
    run(a, 50_000, () => (a.current.proximity?.state.p[1] ?? Infinity) < 600);
    const b = expectExactResume(a, 300);
    expect(b.current.proximity?.state.p).toEqual(a.current.proximity?.state.p);
    expect(b.current.proximity?.assist).toBe(a.current.proximity?.assist);
  }, 60_000);

  it('continues a lunar transfer and a surface stay exactly', () => {
    const plan: LunarMissionPlan = {
      goal: 'capture',
      landing: true,
      refuel: { leo: true, depot: true },
    };
    const a = new FlightRuntime(
      () => undefined,
      () => NOW,
    );
    a.start(context('lunar-landing', plan));
    run(a, 50_000, () => a.current.program.program === 'none' && a.current.progress.orbit);
    a.refuel();
    run(a, 50_000, () => !!a.current.progress.lunar?.refuelLeo);
    a.engage('translunar');
    run(a, 3_000);
    const mid = expectExactResume(a, 300);
    expect(mid.current.lunar?.guidance.phase).toBe(a.current.lunar?.guidance.phase);
    run(a, 400_000, () => a.current.program.program === 'none');
    a.refuel();
    run(a, 50_000, () => !!a.current.progress.lunar?.refuelDepot);
    a.setLunarSite('aurora-highlands');
    a.engage('lunar-descent');
    run(a, 400_000, () => a.current.phase !== 'flight');
    expect(a.current.phase).toBe('surface');
    const b = expectExactResume(a, 50);
    expect(b.current.lunar?.site.id).toBe('aurora-highlands');
    expect(b.current.lunar?.surface?.elapsedS).toBe(a.current.lunar?.surface?.elapsedS);
    expect(b.liftOff().ok).toBe(true);
  }, 120_000);
});
