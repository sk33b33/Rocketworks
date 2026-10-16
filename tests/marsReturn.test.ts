import { describe, expect, it } from 'vitest';
import { EVA_RULES } from '../src/surface/eva';
import { collectAll } from './evaHelpers';
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { locationFor } from '../src/app/flightAutosave';
import { evaluateFlight, NO_PROGRESS, objectivesFor } from '../src/flight/flightOutcome';
import { initialFlightState, type FlightState } from '../src/flight/flightModel';
import { flownFromMars, FlightRuntime } from '../src/flight/flightRuntime';
import { orbitalElements } from '../src/flight/orbitMath';
import { deriveShipSpec } from '../src/flight/shipSpec';
import type { FlightRecord, MarsSummary } from '../src/launch/flightRecord';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { ASCENT_START, runMarsAscent } from '../src/mars/marsAscent';
import {
  MARS_IDLE,
  MarsFlight,
  NO_MARS_PROGRESS,
  type MarsMissionPlan,
} from '../src/mars/marsFlight';
import { groundHeightAt, stepMarsFlight, type MarsGround } from '../src/mars/marsModel';
import {
  checkMarsReturnLegs,
  drawFromPlant,
  MARS_ASCENT_DV_MS,
  marsSurfaceTasks,
  PLANT_TRANSFER_KG_PER_DAY,
  plantRateKgPerDay,
  plantStockKg,
  plantTransferKg,
  type MarsBase,
} from '../src/mars/marsRules';
import { MARS_SITES, marsTerrain } from '../src/mars/marsSites';
import {
  bestTransfer,
  MARS_PARKING_ALT_M,
  MAX_RETURN_VINF_MS,
  referenceDay,
  windowStatus,
} from '../src/mars/marsTransfer';
import {
  DAY_S,
  FIRST_WINDOW_DAY,
  MARS_BODY,
  MARS_RADIUS_M,
  SYNODIC_S,
} from '../src/mars/solarSystem';
import { generateConditions } from '../src/missions/conditions';
import { evaluateMission } from '../src/missions/missionReadiness';
import {
  createDefaultSetup,
  selectMission,
  setRecovery,
  toggleCrew,
  waitForNextWindow,
} from '../src/missions/missionSetup';
import { checkRuntimeSnapshot, decodeJson, encodeJson } from '../src/persistence/flightSave';
import { DEFAULT_UI, parseSave, serializeSave, type SaveData } from '../src/persistence/saveGame';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { certify } from '../src/rocket/readiness/certification';
import { evaluateReadiness } from '../src/rocket/readiness/readiness';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';
/** The plant a cargo flight left at Delta Hollow on day 505. */
const BASE: MarsBase = {
  siteId: 'delta-hollow',
  siteName: 'Delta Hollow',
  sinceDay: 505,
  ice: 0.6,
};
/** Launch day inside the second Earth–Mars window. */
const LAUNCH_DAY = 1_020;

describe('return windows', () => {
  it('opens Mars–Earth windows after the first arrival, once per synodic period', () => {
    const ref = referenceDay('home');
    // The first return opportunity comes over a year after the first Mars arrival.
    expect(ref).toBeGreaterThan(FIRST_WINDOW_DAY + 259 + 300);
    expect(ref).toBeLessThan(FIRST_WINDOW_DAY + 780);
    const w = windowStatus(ref, 'home');
    expect(w.open).toBe(true);
    const next = windowStatus(w.closesDay + 1, 'home');
    expect(next.open).toBe(false);
    expect(next.bestDay - w.bestDay).toBeCloseTo(SYNODIC_S / DAY_S, 3);
  });

  it('plans the burn home from low Mars orbit with an arrival fit for aerocapture', () => {
    const t = bestTransfer(
      windowStatus(referenceDay('home'), 'home').bestDay * DAY_S,
      undefined,
      'home',
    )!;
    expect(t.tmiDvMS).toBeGreaterThan(1_800);
    expect(t.tmiDvMS).toBeLessThan(2_500);
    expect(t.vInfArrMS).toBeLessThan(MAX_RETURN_VINF_MS);
    // Earth entry about 11.5 km/s, a little faster than a lunar return.
    expect(t.entrySpeedMS).toBeGreaterThan(11_000);
    expect(t.entrySpeedMS).toBeLessThan(12_500);
  });
});

describe('the propellant plant and the legs home', () => {
  it('pumps limited by the pump, the stock (plus production) and the room in the tanks', () => {
    const rate = plantRateKgPerDay(0.6);
    expect(plantTransferKg(DAY_S, 1e9, rate, 1e9)).toBeCloseTo(PLANT_TRANSFER_KG_PER_DAY, 6);
    expect(plantTransferKg(10 * DAY_S, 50_000, rate, 1e9)).toBeCloseTo(50_000 + 10 * rate, 6);
    expect(plantTransferKg(10 * DAY_S, 1e9, rate, 30_000)).toBe(30_000);
    expect(plantTransferKg(-5, 1e9, rate, 1e9)).toBe(0);
  });

  it('carries what is left after a ship draws from it', () => {
    const before = plantStockKg(BASE, 1_500);
    const after = drawFromPlant(BASE, 1_500, 600_000);
    expect(after.sinceDay).toBe(1_500);
    expect(plantStockKg(after, 1_500)).toBe(before - 600_000);
    expect(plantStockKg(after, 1_510)).toBe(before - 600_000 + 10 * plantRateKgPerDay(0.6));
    // Never negative, and production continues from empty.
    expect(plantStockKg(drawFromPlant(BASE, 1_500, 5e9), 1_500)).toBe(0);
  });

  it('checks the ascent, the burn home and the Earth arrival on what the tanks hold', () => {
    const spec = deriveShipSpec(createCompleteStarterDesign(NOW), 8_000);
    const full = checkMarsReturnLegs(2_200, spec.stage.propellantKg, spec.stage.dryMassKg, 350);
    expect([full.ascent.ok, full.transfer.ok, full.earth.ok]).toEqual([true, true, true]);
    const half = checkMarsReturnLegs(2_200, 400_000, spec.stage.dryMassKg, 350);
    expect(half.ascent.ok).toBe(true);
    expect(half.transfer.ok).toBe(false);
    expect(half.earth.availableMS).toBe(0);
  });
});

describe('Mars ascent', () => {
  it('climbs from every site to a safe low orbit within the ascent allowance', () => {
    const spec = deriveShipSpec(createCompleteStarterDesign(NOW), 8_000);
    for (const site of MARS_SITES) {
      const ground: MarsGround = { site, terrain: marsTerrain(site), siteAngle: 0 };
      let s: FlightState = {
        ...initialFlightState(
          [0, MARS_RADIUS_M + groundHeightAt(0, ground) + 0.5],
          [0, 0],
          spec.stage.propellantKg,
        ),
        origin: 'mars',
        pitchDeg: 90,
      };
      let g = ASCENT_START;
      for (let i = 0; i < 100_000; i++) {
        const out = runMarsAscent(g, s, spec, ground);
        g = out.next;
        if (out.done) break;
        s = stepMarsFlight(s, spec, out.controls, 0.05, ground);
        expect(s.phase).toBe('flight');
      }
      expect(g.phase).toBe('done');
      const el = orbitalElements(s.r, s.v, MARS_BODY);
      expect(el.status).toBe('orbit');
      expect(el.periapsisAltM).toBeGreaterThan(MARS_PARKING_ALT_M * 0.75);
      expect(el.apoapsisAltM).toBeLessThan(MARS_PARKING_ALT_M * 1.3);
      const dry = spec.stage.dryMassKg;
      const used = 350 * 9.80665 * Math.log((dry + spec.stage.propellantKg) / (dry + s.propKg));
      expect(used).toBeLessThan(MARS_ASCENT_DV_MS);
      expect(s.hull).toBeGreaterThan(0.95);
    }
  });
});

/** A crewed round trip from orbit insertion, in the runtime. */
function crewedRuntime(plan: Partial<MarsMissionPlan> = {}) {
  const bp = createCompleteStarterDesign(NOW);
  const vehicle = deriveFlightVehicle(bp, 8_000);
  const lc: LaunchContext = {
    outcome: {
      id: 'c1',
      at: NOW,
      missionId: 'mars-crewed',
      missionName: 'Mars Expedition',
      designId: bp.id,
      designName: bp.name,
      crewed: true,
    },
    blueprint: bp,
    designRevision: bp.revision,
    crewed: true,
    crewNames: ['Mara Okafor', 'Tomas Lindqvist'],
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
      launchDay: LAUNCH_DAY,
      refuelLeo: true,
      plant: false,
      crewed: true,
      base: BASE,
      ...plan,
    }),
  );
  const frames = (n: number, until: () => boolean) => {
    for (let i = 0; i < n && !until(); i++) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      rt.update(0.1);
    }
  };
  /** Flies out and lands next to the plant. */
  const toMars = () => {
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.mars?.refuelLeo);
    expect(rt.engage('trans-mars').ok).toBe(true);
    frames(400_000, () => rt.current.phase === 'voyage');
    // The crew lands at the plant: no other site.
    expect(rt.setMarsSite('boreal-flats').ok).toBe(false);
    frames(400_000, () => rt.current.phase !== 'voyage');
    expect(rt.current.phase).toBe('surface');
  };
  return { rt, records, frames, toMars };
}

/** Snapshot through JSON into a fresh runtime, step both identically and compare. */
function expectExactResume(a: FlightRuntime, frames: number) {
  const snap = a.snapshot()!;
  expect(checkRuntimeSnapshot(decodeJson(encodeJson(snap)))).toBeNull();
  const b = new FlightRuntime(
    () => undefined,
    () => NOW,
  );
  b.restore(decodeJson(encodeJson(snap)) as typeof snap);
  b.togglePause();
  for (let i = 0; i < frames; i++)
    for (const rt of [a, b]) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      rt.update(0.1);
    }
  expect(b.liveState!.tS).toBe(a.liveState!.tS);
  expect(b.liveState!.r).toEqual(a.liveState!.r);
  expect(b.liveState!.v).toEqual(a.liveState!.v);
  expect(b.liveState!.propKg).toBe(a.liveState!.propKg);
  expect(b.current.phase).toBe(a.current.phase);
  expect(b.current.progress.mars).toEqual(a.current.progress.mars);
}

describe('crewed Mars round trip', () => {
  it('flies the crew to the plant, refuels, waits for the window, flies home and is credited', () => {
    const { rt, records, frames, toMars } = crewedRuntime();
    toMars();
    const landing = rt.current.progress.mars!.landing!;
    expect(landing).toMatchObject({ outcome: 'landed', siteId: 'delta-hollow' });
    expect(landing.missM).toBeLessThan(2_000);
    // A geology EVA on Mars: the window can't be skipped while someone is outside.
    expect(rt.beginEva().ok).toBe(true);
    expect(rt.current.eva?.body).toBe('mars');
    expect(rt.waitForReturnWindow().ok).toBe(false);
    collectAll(rt, EVA_RULES.mars.reachM, EVA_RULES.mars.boardM);
    expect(rt.boardShip().ok).toBe(true);
    expect(rt.current.progress.eva).toMatchObject({ body: 'mars', samples: 3, walks: 1 });
    // The line can only be connected once the crew has done the hook-up EVA.
    expect(rt.plantRefuel(true).ok).toBe(false);
    frames(100_000, () => !!rt.current.mars?.plant?.available.ok);
    const before = rt.liveState!.propKg;
    expect(rt.plantRefuel(true).ok).toBe(true);
    expect(rt.waitForReturnWindow().ok).toBe(true);
    const m = rt.current.mars!;
    expect(m.returnWindow!.open).toBe(true);
    expect(m.surface!.done).toBe(true);
    const cap = rt.current.context!.spec.stage.propellantKg;
    expect(rt.liveState!.propKg).toBeCloseTo(cap, 3);
    expect(rt.current.progress.mars!.plantDrawKg).toBeCloseTo(cap - before, 3);
    expect(m.plant!.stockKg).toBeGreaterThan(0);
    expect(rt.waitForReturnWindow().ok).toBe(false);

    expect(rt.liftOff().ok).toBe(true);
    expect(rt.current.phase).toBe('voyage');
    frames(100_000, () => rt.current.program.program === 'none');
    expect(rt.current.progress.mars!.marsOrbit).toBe(true);
    expect(rt.engage('trans-earth-mars').ok).toBe(true);
    frames(400_000, () => rt.liveState!.origin === 'sun');
    expect(rt.current.progress.mars!.tei).toBe(true);
    expect(locationFor(rt.snapshot()!)).toBe('mars');
    // Cruise home; inside Earth's sphere of influence the ship is followed at Flight / Orbit.
    frames(800_000, () => !rt.liveState!.origin);
    expect(rt.current.phase).toBe('voyage');
    expect(flownFromMars(rt.current)).toBe(false);
    expect(locationFor(rt.snapshot()!)).toBe('flight');
    frames(800_000, () => rt.current.phase !== 'voyage');
    expect(rt.current.phase).toBe('flight');
    expect(rt.current.program.program).toBe('earth-aerocapture');
    frames(400_000, () => rt.current.program.program === 'none');
    const el = orbitalElements(rt.liveState!.r, rt.liveState!.v);
    expect(el.status).toBe('orbit');
    expect(el.apoapsisAltM).toBeLessThan(1_000_000);
    expect(rt.liveState!.shield).toBeGreaterThan(0.5);
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    const rec = records[0]!;
    expect(rec).toMatchObject({ result: 'success', credited: true, crewSafe: true });
    expect(rec.landing?.outcome).toBe('landed');
    expect(rec.mars!.returnTrip).toMatchObject({
      liftedOff: true,
      marsOrbit: true,
      tei: true,
      earthArrived: true,
    });
    expect(rec.mars!.returnTrip!.surfaceDays!).toBeGreaterThan(300);
    expect(rec.mars!.returnTrip!.homeCruiseDays!).toBeGreaterThan(200);
    expect(rec.mars!.returnTrip!.plantDrawDay!).toBeGreaterThan(LAUNCH_DAY + 250);
    expect(rec.mars!.correctionDvMS).toBeLessThan(150);
    expect(rec.durationS / DAY_S).toBeGreaterThan(800);
  }, 240_000);

  it('resumes exactly while pumping on the surface, cruising home and approaching Earth', () => {
    const { rt, frames, toMars } = crewedRuntime();
    toMars();
    frames(100_000, () => !!rt.current.mars?.plant?.available.ok);
    expect(rt.plantRefuel(true).ok).toBe(true);
    frames(50, () => false);
    expectExactResume(rt, 300);
    expect(rt.waitForReturnWindow().ok).toBe(true);
    expect(rt.liftOff().ok).toBe(true);
    frames(100_000, () => rt.current.program.program === 'none');
    expect(rt.engage('trans-earth-mars').ok).toBe(true);
    frames(400_000, () => rt.liveState!.origin === 'sun');
    frames(20, () => false);
    expectExactResume(rt, 40);
    frames(800_000, () => !rt.liveState!.origin);
    frames(5, () => false);
    expectExactResume(rt, 40);
  }, 240_000);

  it('needs a landing within reach of the plant to run a propellant line', () => {
    const plan: MarsMissionPlan = {
      launchDay: LAUNCH_DAY,
      refuelLeo: true,
      plant: false,
      crewed: true,
      base: BASE,
    };
    const site = MARS_SITES.find((x) => x.id === 'delta-hollow')!;
    const far = MarsFlight.fromSnapshot({
      plan,
      siteId: site.id,
      siteAngle: 0,
      g: MARS_IDLE,
      p: {
        ...NO_MARS_PROGRESS,
        landedT: 0,
        landing: {
          siteId: site.id,
          siteName: site.name,
          outcome: 'landed',
          grade: 'C',
          manual: true,
          missM: 5_000,
        },
      },
      op: null,
      surface: { startT: 0, tasks: marsSurfaceTasks(site, false, true) },
      surfaceElapsed: 10 * DAY_S,
      manualLow: true,
      assistedLow: false,
    });
    const spec = deriveShipSpec(createCompleteStarterDesign(NOW), 8_000);
    const s: FlightState = { ...initialFlightState([0, MARS_RADIUS_M], [0, 0], 0), origin: 'mars' };
    const a = far.plantAvailability(s, spec);
    expect(a.ok).toBe(false);
    expect(a.reason).toContain('too far');
    expect(far.liftOffAvailability(s).ok).toBe(false); // empty tanks
    expect(far.liftOffAvailability({ ...s, propKg: 1_000 }).ok).toBe(true);
  });

  it('leaves a crew that ends the flight on Mars to be rescued (aborted, not credited)', () => {
    const { rt, records, frames, toMars } = crewedRuntime();
    toMars();
    rt.endFlight();
    frames(10, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'aborted', credited: false, crewSafe: true });
    expect(records[0]!.summary).toContain('assumed rescued');
  }, 240_000);

  it('records crashes and breakups on the way home as fatal', () => {
    const ctx = {
      outcome: {
        id: 'x',
        at: NOW,
        missionId: 'mars-crewed',
        missionName: 'Mars Expedition',
        designId: 'd',
        designName: 'D',
        crewed: true,
      },
      zone: { id: 'rtls', name: 'Pad' } as never,
      ascent: { maxAltitudeM: 0, maxSpeedMS: 0, maxQPa: 0, events: [] },
      maxAltitudeM: 0,
      maxSpeedMS: 0,
    };
    const m: MarsSummary = {
      launchDay: LAUNCH_DAY,
      departed: true,
      cruiseDays: 260,
      corrections: 3,
      correctionDvMS: 20,
      entrySpeedMS: 5_600,
      landing: {
        siteId: 'delta-hollow',
        siteName: 'Delta Hollow',
        outcome: 'landed',
        grade: 'A',
        manual: false,
        missM: 100,
      },
      surfaceDone: true,
      plantRunning: false,
      ice: 0.6,
      landedDay: 1_280,
      returnTrip: {
        plantDrawKg: 900_000,
        plantDrawDay: 1_300,
        liftedOff: true,
        marsOrbit: false,
        tei: false,
        surfaceDays: 400,
        homeCruiseDays: null,
        earthArrived: false,
      },
    };
    const crashed: FlightState = {
      ...initialFlightState([0, MARS_RADIUS_M], [0, 0], 0),
      origin: 'mars',
      phase: 'crashed',
    };
    const rec = evaluateFlight({ ...ctx, mars: m }, crashed, NO_PROGRESS, NOW);
    expect(rec).toMatchObject({ result: 'failure', credited: false, crewSafe: false });
    expect(rec.summary).toContain('after lifting off');
    expect(objectivesFor('mars-crewed', { leo: true, depot: false })).toEqual([
      'orbit',
      'refuel',
      'tmi',
      'mars-arrival',
      'mars-landing',
      'mars-crew-tasks',
      'mars-refuel',
      'mars-ascent',
      'tei',
      'mars-return',
      'reentry',
      'landing',
    ]);
  });
});

describe('Mars Expedition planning', () => {
  const VCTX = { unlockedPartIds: new Set<string>(), budgetCredits: 1e9 };
  const done = [
    'test-flight',
    'orbital-flight',
    'station-docking',
    'lunar-transfer',
    'lunar-landing',
    'mars-cargo',
  ];
  const certified = (bp: RocketBlueprint) => {
    const r = certify(bp, evaluateReadiness(bp, VCTX), false, NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.blueprint;
  };
  const setupFor = (designId: string) => {
    const sel = selectMission(createDefaultSetup(designId), 'mars-crewed', done);
    if (!sel.ok) throw new Error(sel.reason);
    let s = setRecovery(sel.setup, 'platform');
    for (const id of ['okafor', 'lindqvist']) {
      const r = toggleCrew(s, id);
      if (r.ok) s = r.setup;
    }
    for (let i = 0; i < 200 && generateConditions(s.conditionsSeed).overall !== 'green'; i++)
      s = waitForNextWindow(s);
    return s;
  };
  const report = (base: MarsBase | null, day: number) => {
    const bp = certified(createCompleteStarterDesign(NOW));
    return evaluateMission({
      setup: setupFor(bp.id),
      blueprint: bp,
      vehicleReport: evaluateReadiness(bp, VCTX),
      completedMissionIds: done,
      calendarDay: day,
      marsBase: base,
    });
  };

  it('defaults to the supplies, and needs a running plant', () => {
    const s = setupFor('x');
    expect(s.payloadId).toBe('mars-supplies');
    const r = report(null, LAUNCH_DAY);
    expect(r.issues.map((i) => i.id)).toContain('mars-no-plant');
  });

  it('is GO for the crewed reference ship in the window, with the way home forecast', () => {
    const r = report(BASE, LAUNCH_DAY);
    expect(r.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    const trip = r.mars!.roundTrip!;
    expect(trip.legs.every((l) => l.ok)).toBe(true);
    expect(trip.stayDays).toBeGreaterThan(300);
    expect(trip.returnOpensDay).toBeGreaterThan(trip.arrivalDay);
    expect(trip.stockKg).toBeGreaterThan(trip.neededKg);
    // The supplies carry the crew through the whole trip.
    expect(r.lifeSupport.capacityCrewDays).toBeGreaterThanOrEqual(r.lifeSupport.requiredCrewDays);
  });

  it('warns when the plant cannot make enough by the return window', () => {
    const young: MarsBase = { ...BASE, sinceDay: LAUNCH_DAY - 10, ice: 0 };
    const r = report(young, LAUNCH_DAY);
    expect(r.issues.map((i) => i.id)).toContain('mars-plant-stock');
  });
});

describe('Mars base saves', () => {
  it('keeps the plant stock carried over after a draw', () => {
    const bp = createCompleteStarterDesign(NOW);
    const data: Omit<SaveData, 'saveVersion'> = {
      savedAt: NOW,
      activeBlueprintId: bp.id,
      blueprints: [bp],
      progression: {
        milestones: [],
        tech: [],
        completedMissions: ['mars-cargo'],
        calendarDay: 2_000,
        marsBase: { ...BASE, sinceDay: 1_700, carriedKg: 120_000 },
      },
      mission: null,
      ui: DEFAULT_UI,
      flights: [],
      fleet: [],
    };
    const r = parseSave(serializeSave(data));
    expect(r.status).toBe('loaded');
    if (r.status !== 'loaded') return;
    expect(r.data.progression.marsBase).toEqual({ ...BASE, sinceDay: 1_700, carriedKg: 120_000 });
  });
});
