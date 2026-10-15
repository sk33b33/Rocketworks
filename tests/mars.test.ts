import { describe, expect, it } from 'vitest';
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { locationFor } from '../src/app/flightAutosave';
import { evaluateFlight, NO_PROGRESS } from '../src/flight/flightOutcome';
import { initialFlightState, type FlightState } from '../src/flight/flightModel';
import { FlightRuntime } from '../src/flight/flightRuntime';
import { deriveShipSpec } from '../src/flight/shipSpec';
import type { FlightRecord } from '../src/launch/flightRecord';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { propagateKepler, solveTransfer, type KeplerState } from '../src/mars/kepler';
import { approachMetric, solveImpulse, timeToRadius } from '../src/mars/marsCruise';
import { ENTRY_START, lockSiteAngle, marsGeometry, runMarsDescent } from '../src/mars/marsEntry';
import type { MarsMissionPlan } from '../src/mars/marsFlight';
import { stepMarsFlight, type MarsGround } from '../src/mars/marsModel';
import {
  checkMarsLegs,
  marsSurfaceDurationS,
  marsSurfaceProgress,
  marsSurfaceTasks,
  plantRateKgPerDay,
  plantStockKg,
} from '../src/mars/marsRules';
import { findMarsSite, MARS_SITES, marsTerrain } from '../src/mars/marsSites';
import { bestTransfer, windowStatus } from '../src/mars/marsTransfer';
import {
  DAY_S,
  FIRST_WINDOW_DAY,
  HOHMANN_TOF_S,
  MARS_MU_M3S2,
  MARS_RADIUS_M,
  MARS_SOI_M,
  marsPhase,
  HOHMANN_PHASE_RAD,
  planetState,
  SUN_MU_M3S2,
  SYNODIC_S,
} from '../src/mars/solarSystem';
import { checkRuntimeSnapshot, decodeJson, encodeJson } from '../src/persistence/flightSave';
import { migrateSave } from '../src/persistence/migrations';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { generateConditions } from '../src/missions/conditions';
import { evaluateMission } from '../src/missions/missionReadiness';
import {
  createDefaultSetup,
  selectMission,
  setRecovery,
  waitForNextWindow,
} from '../src/missions/missionSetup';
import { replacePart } from '../src/rocket/assembly/operations';
import { setRole } from '../src/rocket/library/blueprintLibrary';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { certify } from '../src/rocket/readiness/certification';
import { evaluateReadiness } from '../src/rocket/readiness/readiness';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';

describe('solar system and transfers', () => {
  it('places the first Hohmann opportunity on the planned day and repeats it every synodic period', () => {
    const t = FIRST_WINDOW_DAY * DAY_S;
    expect(marsPhase(t)).toBeCloseTo(HOHMANN_PHASE_RAD, 9);
    expect(marsPhase(t + SYNODIC_S)).toBeCloseTo(HOHMANN_PHASE_RAD, 6);
    expect(SYNODIC_S / DAY_S).toBeCloseTo(780, 0);
  });

  it('propagates conics exactly: circular orbits and long hyperbolic arcs', () => {
    const e0 = planetState('earth', 0);
    const e1 = planetState('earth', 300 * DAY_S);
    const p = propagateKepler({ r: e0.r, v: e0.v }, SUN_MU_M3S2, 300 * DAY_S);
    expect(Math.hypot(p.r[0] - e1.r[0], p.r[1] - e1.r[1])).toBeLessThan(10);
    const s0 = { r: [MARS_SOI_M, 1e7] as const, v: [-2_700, 30] as const };
    const out = propagateKepler(s0, MARS_MU_M3S2, 10 * DAY_S);
    const back = propagateKepler(out, MARS_MU_M3S2, -10 * DAY_S);
    expect(Math.hypot(back.r[0] - s0.r[0], back.r[1] - s0.r[1])).toBeLessThan(1);
  });

  it('solves the Hohmann transfer with the textbook excess speeds', () => {
    const t = FIRST_WINDOW_DAY * DAY_S;
    const e = planetState('earth', t);
    const m = planetState('mars', t + HOHMANN_TOF_S);
    const sol = solveTransfer(e.r, m.r, HOHMANN_TOF_S, SUN_MU_M3S2)!;
    expect(sol).not.toBeNull();
    expect(Math.hypot(sol.v1[0] - e.v[0], sol.v1[1] - e.v[1])).toBeCloseTo(2_945, -1);
    expect(Math.hypot(sol.v2[0] - m.v[0], sol.v2[1] - m.v[1])).toBeCloseTo(2_649, -1);
  });

  it('opens windows around each opportunity and keeps arrivals within the entry limit', () => {
    const closed = windowStatus(0);
    expect(closed.open).toBe(false);
    expect(closed.opensInDays).toBeGreaterThan(150);
    const open = windowStatus(FIRST_WINDOW_DAY);
    expect(open.open).toBe(true);
    expect(open.today!.tmiDvMS).toBeGreaterThan(3_500);
    expect(open.today!.tmiDvMS).toBeLessThan(3_700);
    expect(open.closesDay - open.opensDay).toBeGreaterThan(40);
    // The next window is one synodic period later.
    const next = windowStatus(open.closesDay + 1);
    expect(next.bestDay - open.bestDay).toBeCloseTo(SYNODIC_S / DAY_S, 3);
    for (const off of [-30, 0, 30]) {
      const t = bestTransfer((FIRST_WINDOW_DAY + off) * DAY_S)!;
      expect(t.vInfArrMS).toBeLessThanOrEqual(3_200 + 1);
    }
  });
});

describe('Mars rules', () => {
  it('checks the injection and landing legs against refuelling', () => {
    const [tmi, land] = checkMarsLegs(3_600, true, 6_700, 1_000);
    expect(tmi!.ok).toBe(true);
    expect(land!.ok).toBe(true);
    const dry = checkMarsLegs(3_600, false, 6_700, 1_000);
    expect(dry.map((c) => c.ok)).toEqual([false, false]);
    expect(checkMarsLegs(null, true, 6_700, 1_000)[0]!.ok).toBe(false);
  });

  it('runs surface tasks in order and makes propellant by the day', () => {
    const tasks = marsSurfaceTasks(MARS_SITES[0]!, true);
    const total = marsSurfaceDurationS(tasks);
    expect(total).toBeCloseTo((2 / 24 + 1 + 1.5 + 3) * DAY_S, -2);
    const mid = marsSurfaceProgress(tasks, 2 * 3_600 + DAY_S / 2);
    expect(mid[0]).toBe(1);
    expect(mid[tasks.findIndex((t) => t.id === 'deploy')]).toBe(0);
    expect(marsSurfaceProgress(tasks, total).every((p) => p === 1)).toBe(true);
    const base = { siteId: 'boreal-flats', siteName: 'Boreal Flats', sinceDay: 100, ice: 1 };
    expect(plantStockKg(base, 90)).toBe(0);
    expect(plantStockKg(base, 110)).toBe(10 * plantRateKgPerDay(1));
    expect(plantRateKgPerDay(1, true)).toBeGreaterThan(plantRateKgPerDay(1));
    expect(plantRateKgPerDay(0.25)).toBeLessThan(plantRateKgPerDay(1));
  });
});

/** A standard approach from Mars's sphere of influence, corrected onto the entry corridor. */
function approachState(propKg = 150_000): FlightState {
  const vinf = 2_650;
  let rel: KeplerState = {
    r: [MARS_SOI_M * 0.99, 2e7],
    v: [-Math.sqrt(vinf ** 2 + (2 * MARS_MU_M3S2) / MARS_SOI_M), 0],
  };
  const dv = solveImpulse(rel, approachMetric, 200)!;
  rel = { r: rel.r, v: [rel.v[0] + dv[0], rel.v[1] + dv[1]] };
  const at = propagateKepler(rel, MARS_MU_M3S2, timeToRadius(rel, MARS_RADIUS_M + 140_000)!);
  return { ...initialFlightState(at.r, at.v, propKg, 0), origin: 'mars' };
}

describe('Mars entry and landing', () => {
  const spec = deriveShipSpec(createCompleteStarterDesign(NOW), 40_000);

  for (const id of ['boreal-flats', 'redstone-plateau']) {
    it(`flies the entry and lands on the target at ${id}`, () => {
      const site = findMarsSite(id)!;
      const terrain = marsTerrain(site);
      let s = approachState();
      const angle = lockSiteAngle(s, spec, { site, terrain })!;
      expect(angle).not.toBeNull();
      const ground: MarsGround = { site, terrain, siteAngle: angle };
      let g = ENTRY_START;
      let peakHeat = 0;
      for (let i = 0; i < 40_000 && s.phase === 'flight'; i++) {
        const out = runMarsDescent(g, s, spec, ground, 0.05);
        g = out.next;
        s = stepMarsFlight(s, spec, out.controls, 0.05, ground);
        peakHeat = Math.max(peakHeat, s.heatFluxWm2);
      }
      expect(s.phase).toBe('landed');
      expect(s.touchdown?.body).toBe('mars');
      expect(Math.abs(s.touchdown!.siteOffsetM!)).toBeLessThan(300);
      expect(s.touchdown!.vertMS).toBeLessThan(3);
      expect(peakHeat).toBeGreaterThan(100_000);
      expect(s.shield).toBeGreaterThan(0.9);
      expect(s.propKg).toBeGreaterThan(0);
    });
  }

  it('tips over on steep ground and crashes when fast', () => {
    const site = MARS_SITES[0]!;
    const fake = (slope: number) =>
      ({
        site,
        terrain: { halfSpanM: 40_000, heightAt: () => 0, slopeAt: () => slope },
        siteAngle: 0,
      }) as unknown as MarsGround;
    const fall = (vert: number, slope: number) => {
      const r: [number, number] = [0, MARS_RADIUS_M + site.elevationM + 1];
      let s: FlightState = {
        ...initialFlightState(r, [0, -vert], 10_000),
        origin: 'mars',
        pitchDeg: 90,
      };
      const c = { targetPitchDeg: 90, bankDeg: 0, yawDeg: 0, throttle: 0, slewDegS: 8 };
      for (let i = 0; i < 400 && s.phase === 'flight'; i++)
        s = stepMarsFlight(s, spec, c, 0.05, fake(slope));
      return s;
    };
    expect(fall(1.5, 3).phase).toBe('landed');
    expect(fall(1.5, 14).phase).toBe('tipped');
    expect(fall(12, 0).phase).toBe('crashed');
    const hard = fall(5, 2);
    expect(hard.phase).toBe('landed');
    expect(hard.hull).toBeLessThan(1);
  });
});

/** A Mars cargo flight from orbit insertion, in the runtime. */
function marsRuntime(plan: Partial<MarsMissionPlan> = {}) {
  const bp = createCompleteStarterDesign(NOW);
  const vehicle = deriveFlightVehicle(bp, 40_000);
  const lc: LaunchContext = {
    outcome: {
      id: 'm1',
      at: NOW,
      missionId: 'mars-cargo',
      missionName: 'Mars Cargo Lander',
      designId: bp.id,
      designName: bp.name,
      crewed: false,
    },
    blueprint: bp,
    designRevision: bp.revision,
    crewed: false,
    crewNames: [],
    config: {
      vehicle,
      target: { kind: 'orbit', altitudeM: 150_000 },
      failures: [],
      boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION.platform,
    },
  };
  const records: FlightRecord[] = [];
  const rt = new FlightRuntime(
    (r) => records.push(r),
    () => NOW,
  );
  rt.start(
    flightContextFromLaunch(lc, simulateAscent(lc.config, SIM_DT_S), null, undefined, undefined, {
      launchDay: 245,
      refuelLeo: true,
      plant: true,
      ...plan,
    }),
  );
  const frames = (n: number, until: () => boolean) => {
    for (let i = 0; i < n && !until(); i++) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      rt.update(0.1);
    }
  };
  return { rt, records, frames };
}

/** Snapshot through JSON into a fresh runtime, step both identically and compare. */
function expectExactResume(a: FlightRuntime, frames: number) {
  const snap = a.snapshot()!;
  expect(snap).not.toBeNull();
  expect(checkRuntimeSnapshot(decodeJson(encodeJson(snap)))).toBeNull();
  const b = new FlightRuntime(
    () => undefined,
    () => NOW,
  );
  b.restore(decodeJson(encodeJson(snap)) as typeof snap);
  expect(b.current.paused).toBe(true);
  b.togglePause();
  for (let i = 0; i < frames; i++)
    for (const rt of [a, b]) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      rt.update(0.1);
    }
  expect(b.liveState!.tS).toBe(a.liveState!.tS);
  expect(b.liveState!.r).toEqual(a.liveState!.r);
  expect(b.liveState!.v).toEqual(a.liveState!.v);
  expect(b.current.progress.mars).toEqual(a.current.progress.mars);
  return b;
}

describe('Mars cargo mission', () => {
  it('flies a credited mission: refuel, injection, cruise, entry, landing and the plant', () => {
    const { rt, records, frames } = marsRuntime();
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.mars?.refuelLeo);
    expect(rt.engage('trans-mars').ok).toBe(true);
    frames(400_000, () => rt.current.phase === 'voyage');
    expect(rt.current.phase).toBe('voyage');
    expect(rt.liveState!.origin).toBe('sun');
    expect(rt.setMarsSite('delta-hollow').ok).toBe(true);
    frames(400_000, () => rt.current.phase !== 'voyage');
    const p = rt.current.progress.mars!;
    expect(rt.current.phase).toBe('surface');
    expect(p.siteLocked).toBe(true);
    expect(p.correctionDvMS).toBeLessThan(150);
    expect(p.landing).toMatchObject({ outcome: 'landed', siteId: 'delta-hollow', manual: false });
    expect(rt.setMarsSite('boreal-flats').ok).toBe(false);
    frames(100_000, () => !!rt.current.mars?.progress.surfaceDone);
    rt.endFlight();
    frames(10, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'success', credited: true, crewSafe: null });
    expect(records[0]!.mars).toMatchObject({
      plantRunning: true,
      departed: true,
      surfaceDone: true,
    });
    expect(records[0]!.mars!.cruiseDays).toBeGreaterThan(200);
    expect(records[0]!.mars!.landedDay).toBeGreaterThan(245 + 200);
  }, 120_000);

  it('resumes the cruise and the entry exactly from a saved snapshot', () => {
    const { rt, frames } = marsRuntime();
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    rt.refuel();
    frames(50_000, () => !!rt.current.progress.mars?.refuelLeo);
    rt.engage('trans-mars');
    frames(400_000, () => rt.current.phase === 'voyage');
    frames(30, () => false);
    const cruise = rt.snapshot()!;
    expect(cruise.phase).toBe('voyage');
    expect(locationFor(cruise)).toBe('mars');
    expectExactResume(rt, 200);
    frames(400_000, () => (rt.current.mars?.marsAltitudeM ?? Infinity) < 80_000);
    expect(rt.current.mars!.descent?.phase).toBe('entry');
    const b = expectExactResume(rt, 300);
    expect(b.current.mars!.descent).toEqual(rt.current.mars!.descent);
  }, 120_000);

  it('credits a landing flown manually below the gate', () => {
    const { rt, frames } = marsRuntime();
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    rt.refuel();
    frames(50_000, () => !!rt.current.progress.mars?.refuelLeo);
    rt.engage('trans-mars');
    frames(400_000, () => rt.current.phase === 'voyage');
    frames(
      400_000,
      () =>
        rt.current.mars?.descent?.phase === 'braking' &&
        (rt.current.mars.geometry?.radarM ?? Infinity) < 900,
    );
    // Take over: hold retrograde and fly the sink rate down with the throttle.
    rt.setMode('retrograde');
    expect(rt.current.program.program).toBe('none');
    const spec = rt.current.context!.spec;
    for (let i = 0; i < 20_000 && rt.current.phase === 'voyage'; i++) {
      const s = rt.liveState!;
      if (s.phase !== 'flight') {
        rt.update(0.1);
        continue;
      }
      const v = rt.current.mars!;
      const geo = marsGeometry(s, { site: v.site, terrain: v.terrain, siteAngle: v.siteAngle });
      if (geo.radarM < 6 && rt.current.mode !== 'vertical') rt.setMode('vertical');
      const sink = -Math.max(1.2, Math.min(40, geo.radarM / 8));
      const aV = geo.gEff + (sink - geo.vh) * 1.5;
      const up = Math.max(0.3, Math.sin((s.pitchDeg * Math.PI) / 180));
      const full = spec.stage.engineCount * spec.stage.thrustVacPerEngineN;
      rt.setThrottle(Math.max(0, ((aV / up) * (spec.stage.dryMassKg + s.propKg)) / full));
      rt.update(0.05);
    }
    const landing = rt.current.progress.mars!.landing;
    expect(landing?.outcome).toBe('landed');
    expect(landing?.manual).toBe(true);
  }, 120_000);

  it('refuses programs outside their conditions and records a crash as a failure', () => {
    const { rt, frames } = marsRuntime({ refuelLeo: false });
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(false);
    expect(rt.engage('mars-entry').ok).toBe(false);
    expect(rt.engage('deorbit').ok).toBe(true); // Earth programs still work at Earth
    const ctxOutcome = {
      outcome: {
        id: 'x',
        at: NOW,
        missionId: 'mars-cargo',
        missionName: 'Mars',
        designId: 'd',
        designName: 'D',
        crewed: false,
      },
      zone: rt.current.zone,
      ascent: { maxAltitudeM: 0, maxSpeedMS: 0, maxQPa: 0, events: [] },
      maxAltitudeM: 0,
      maxSpeedMS: 0,
    };
    const base = {
      launchDay: 245,
      departed: true,
      cruiseDays: 260,
      corrections: 2,
      correctionDvMS: 30,
      entrySpeedMS: 5_600,
      landing: null,
      surfaceDone: false,
      plantRunning: false,
      ice: null,
      landedDay: null,
    };
    const crashed: FlightState = {
      ...initialFlightState([0, MARS_RADIUS_M], [0, 0], 0),
      origin: 'mars',
      phase: 'crashed',
      touchdown: { vertMS: 80, horizMS: 0, tiltDeg: 0, body: 'mars' },
    };
    const rec = evaluateFlight({ ...ctxOutcome, mars: base }, crashed, NO_PROGRESS, NOW);
    expect(rec.result).toBe('failure');
    expect(rec.credited).toBe(false);
    const inSpace: FlightState = {
      ...crashed,
      phase: 'flight',
      touchdown: undefined,
      origin: 'sun',
    };
    expect(evaluateFlight({ ...ctxOutcome, mars: base }, inSpace, NO_PROGRESS, NOW).result).toBe(
      'aborted',
    );
  }, 60_000);
});

describe('Mars mission planning', () => {
  const VCTX = { unlockedPartIds: new Set<string>(), budgetCredits: 1e9 };
  const done = [
    'test-flight',
    'orbital-flight',
    'station-docking',
    'lunar-transfer',
    'lunar-landing',
  ];
  const certified = (bp: RocketBlueprint) => {
    const r = certify(bp, evaluateReadiness(bp, VCTX), false, NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.blueprint;
  };
  /** The reference design with its crew cabin swapped for a cargo bay. */
  const cargoDesign = () => {
    const bp = createCompleteStarterDesign(NOW);
    const cabin = bp.parts.find((p) => p.partId === 'crew-cabin')!;
    const r = replacePart(bp, cabin.id, 'cargo-bay', NOW);
    if (!r.ok) throw new Error(r.reason);
    return certified(setRole(r.blueprint, 'cargo', NOW));
  };
  const setupFor = (designId: string) => {
    const sel = selectMission(createDefaultSetup(designId), 'mars-cargo', done);
    if (!sel.ok) throw new Error(sel.reason);
    let s = setRecovery(sel.setup, 'platform');
    for (let i = 0; i < 200 && generateConditions(s.conditionsSeed).overall !== 'green'; i++)
      s = waitForNextWindow(s);
    return s;
  };
  const report = (bp: RocketBlueprint, day: number) =>
    evaluateMission({
      setup: setupFor(bp.id),
      blueprint: bp,
      vehicleReport: evaluateReadiness(bp, VCTX),
      completedMissionIds: done,
      calendarDay: day,
    });

  it('defaults to the plant and orbital refuelling, and needs the launch window and a cargo bay', () => {
    const s = setupFor('x');
    expect(s.payloadId).toBe('mars-plant');
    expect(s.refuel).toEqual({ leo: true, depot: false });
    const crewShip = certified(createCompleteStarterDesign(NOW));
    const closed = report(crewShip, 0);
    const ids = closed.issues.map((i) => i.id);
    expect(ids).toContain('mars-window');
    expect(ids).toContain('payload-bay');
    const wait = closed.issues.find((i) => i.id === 'mars-window')!.action;
    expect(wait).toMatchObject({ kind: 'wait-mars-window' });
  });

  it('is GO for a cargo ship inside the window, with both Δv legs met', () => {
    const r = report(cargoDesign(), FIRST_WINDOW_DAY);
    expect(r.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(r.mars!.window.open).toBe(true);
    expect(r.mars!.legs!.every((l) => l.ok)).toBe(true);
    expect(r.cost.refuelCredits).toBeGreaterThan(0);
  });
});

describe('Mars saves', () => {
  it('migrates v7 saves to a program calendar and no Mars base', () => {
    const r = migrateSave({
      saveVersion: 7,
      progression: { milestones: [], tech: [], completedMissions: [] },
      flights: [{}, {}, {}],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.saveVersion).toBe(9);
    expect(r.data.progression).toMatchObject({ calendarDay: 3, marsBase: null });
  });
});
