import { beforeEach, describe, expect, it } from 'vitest';
import { flightContextFromLaunch } from '../src/app/flightBinding';
import { useGameStore } from '../src/app/gameStore';
import {
  acceptContract,
  advanceEconomy,
  cancelContract,
  contractKindsAvailable,
  generateOffers,
  initialEconomy,
  orbitRaiseDvMS,
  refreshBoard,
  settleContract,
  type Contract,
  type EconomyState,
  type FlightContract,
} from '../src/economy/contracts';
import { canAfford, GRANT_CREDITS, grantsBetween, periodOf } from '../src/economy/treasury';
import { judgeContract, NO_PROGRESS } from '../src/flight/flightOutcome';
import { FlightRuntime } from '../src/flight/flightRuntime';
import { orbitalElements } from '../src/flight/orbitMath';
import type { FlightRecord } from '../src/launch/flightRecord';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { addToPlant, plantStockKg, type MarsBase } from '../src/mars/marsRules';
import { generateConditions } from '../src/missions/conditions';
import { findMission } from '../src/missions/missionCatalog';
import { evaluateMission } from '../src/missions/missionReadiness';
import {
  createDefaultSetup,
  setRecovery,
  setupForContract,
  waitForNextWindow,
} from '../src/missions/missionSetup';
import { migrateSave } from '../src/persistence/migrations';
import { DEFAULT_UI, parseSave, serializeSave, type SaveData } from '../src/persistence/saveGame';
import { economyOf, INITIAL_PROGRESSION, programDay } from '../src/progression/research';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { replacePart } from '../src/rocket/assembly/operations';
import { setRole } from '../src/rocket/library/blueprintLibrary';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { certify } from '../src/rocket/readiness/certification';
import { evaluateReadiness } from '../src/rocket/readiness/readiness';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';
const STORY = [
  'test-flight',
  'orbital-flight',
  'station-docking',
  'lunar-transfer',
  'lunar-landing',
];
const CTX = { completedMissionIds: STORY, hasMarsBase: false };

/** A board with a known satellite offer on it. */
function withSatellite(e: EconomyState = initialEconomy()): { e: EconomyState; offer: Contract } {
  const offer: Contract = {
    id: 'T-1',
    kind: 'satellite',
    client: 'Northline Telecom',
    title: 'Deploy a navigation satellite to a 800 km orbit',
    payloadId: 'nav-sat',
    targetAltKm: 800,
    toleranceKm: 50,
    payout: 150_000,
    repReward: 5,
    repPenalty: 8,
    deadlineDays: 60,
    minReputation: 0,
  };
  return { e: { ...e, board: { period: 0, offers: [offer] } }, offer };
}

describe('treasury', () => {
  it('pays a grant for every 30-day period the calendar crosses', () => {
    expect(periodOf(29)).toBe(0);
    expect(periodOf(30)).toBe(1);
    expect(grantsBetween(10, 20)).toBe(0);
    expect(grantsBetween(29, 31)).toBe(GRANT_CREDITS);
    expect(grantsBetween(0, 95)).toBe(3 * GRANT_CREDITS);
    expect(grantsBetween(95, 10)).toBe(0);
    expect(canAfford(100_000, 100_000)).toBe(true);
    expect(canAfford(99_999, 100_000)).toBe(false);
  });

  it('prices the climb from the parking orbit to a requested orbit', () => {
    expect(orbitRaiseDvMS(150)).toBe(0);
    const low = orbitRaiseDvMS(400);
    const high = orbitRaiseDvMS(1_200);
    expect(low).toBeGreaterThan(100);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(700);
  });
});

describe('contract board', () => {
  it('offers contracts only for flights the program has flown', () => {
    expect(contractKindsAvailable({ completedMissionIds: [], hasMarsBase: false })).toEqual([]);
    expect(generateOffers(3, { completedMissionIds: [], hasMarsBase: false }, 20)).toEqual([]);
    expect(
      contractKindsAvailable({ completedMissionIds: ['orbital-flight'], hasMarsBase: false }),
    ).toEqual(['satellite']);
    expect(contractKindsAvailable(CTX)).toEqual(['satellite', 'resupply', 'lunar-depot']);
    // Tanker runs need the plant on Mars.
    const mars = { completedMissionIds: [...STORY, 'mars-cargo'], hasMarsBase: true };
    expect(contractKindsAvailable(mars)).toContain('mars-tanker');
    expect(contractKindsAvailable({ ...mars, hasMarsBase: false })).not.toContain('mars-tanker');
  });

  it('generates the same board for a period every time, with sensible terms', () => {
    const a = generateOffers(7, CTX, 20);
    expect(generateOffers(7, CTX, 20)).toEqual(a);
    expect(generateOffers(8, CTX, 20)).not.toEqual(a);
    expect(a).toHaveLength(4);
    for (let period = 0; period < 30; period++)
      for (const c of generateOffers(period, CTX, 20)) {
        expect(c.payout).toBeGreaterThan(0);
        expect(c.deadlineDays).toBeGreaterThan(0);
        expect(findMission(`contract-${c.kind}`)?.payloadIds).toContain(c.payloadId);
        if (c.kind === 'satellite') {
          expect(c.targetAltKm).toBeGreaterThanOrEqual(300);
          expect(c.targetAltKm).toBeLessThanOrEqual(1_200);
        } else expect(c.targetAltKm).toBeNull();
      }
    // Reputation raises payouts.
    const rich = generateOffers(7, CTX, 100);
    expect(rich.reduce((s, c) => s + c.payout, 0)).toBeGreaterThan(
      a.reduce((s, c) => s + c.payout, 0),
    );
  });

  it('refreshes the board each period, never showing the active contract again', () => {
    const e0 = refreshBoard(initialEconomy(), 31, CTX);
    expect(e0.board.period).toBe(1);
    expect(refreshBoard(e0, 45, CTX)).toBe(e0);
    const id = e0.board.offers[0]!.id;
    const r = acceptContract(e0, id, 31);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.economy.board.offers.map((o) => o.id)).not.toContain(id);
    const later = refreshBoard(r.economy, 61, CTX);
    expect(later.board.period).toBe(2);
    expect(later.active?.id).toBe(id);
  });

  it('takes one contract at a time and respects premium clients', () => {
    const { e, offer } = withSatellite();
    const r = acceptContract(e, offer.id, 100);
    expect(r.ok && r.contract.deadlineDay).toBe(160);
    if (!r.ok) return;
    const premium = { ...offer, id: 'T-2', minReputation: 60 };
    const second = acceptContract(
      { ...r.economy, board: { period: 0, offers: [premium] } },
      'T-2',
      100,
    );
    expect(second.ok).toBe(false);
    const low = acceptContract({ ...e, board: { period: 0, offers: [premium] } }, 'T-2', 100);
    expect(low.ok === false && low.reason).toMatch(/reputation 60/);
    const cancelled = cancelContract(r.economy, 110);
    expect(cancelled.active).toBeNull();
    expect(cancelled.reputation).toBe(20 - 4);
    expect(cancelled.history.at(-1)).toMatchObject({ result: 'cancelled', payout: 0 });
  });

  it('pays on time, and pays nothing (with reputation lost) when late or failed', () => {
    const { e, offer } = withSatellite();
    const r = acceptContract(e, offer.id, 100);
    if (!r.ok) throw new Error(r.reason);
    const met = { contractId: offer.id, met: true, detail: 'ok' };
    const paid = settleContract(r.economy, met, 150);
    expect(paid.outcome?.result).toBe('paid');
    expect(paid.economy.treasury).toBe(e.treasury + 150_000);
    expect(paid.economy.reputation).toBe(25);
    expect(paid.economy.active).toBeNull();
    const late = settleContract(r.economy, met, 161);
    expect(late.outcome?.result).toBe('late');
    expect(late.economy.treasury).toBe(e.treasury);
    expect(late.economy.reputation).toBe(12);
    const failed = settleContract(r.economy, null, 120);
    expect(failed.outcome?.result).toBe('failed');
    // A result for some other contract changes nothing.
    expect(settleContract(r.economy, { ...met, contractId: 'X' }, 120).outcome).toBeNull();
  });

  it('expires a contract whose deadline passes without a flight, and pays grants', () => {
    const { e, offer } = withSatellite();
    const r = acceptContract(e, offer.id, 100);
    if (!r.ok) throw new Error(r.reason);
    const still = advanceEconomy(r.economy, 100, 150, CTX);
    expect(still.expired).toBeNull();
    expect(still.economy.active?.id).toBe(offer.id);
    const gone = advanceEconomy(r.economy, 100, 200, CTX);
    expect(gone.expired?.result).toBe('expired');
    expect(gone.economy.active).toBeNull();
    expect(gone.economy.treasury).toBe(e.treasury + grantsBetween(100, 200));
    expect(gone.economy.board.period).toBe(periodOf(200));
  });
});

describe('judging contract flights', () => {
  const sat: FlightContract = {
    id: 'C',
    kind: 'satellite',
    title: 't',
    client: 'c',
    targetAltKm: 800,
    toleranceKm: 50,
    payloadKg: 9_000,
    payout: 1,
  };
  it('checks each kind against what the flight did', () => {
    expect(judgeContract(sat, NO_PROGRESS).met).toBe(false);
    expect(
      judgeContract(sat, { ...NO_PROGRESS, release: { apoKm: 810, periKm: 790, ok: true } }).met,
    ).toBe(true);
    const resupply = { ...sat, kind: 'resupply' as const, targetAltKm: null };
    const docked = {
      grade: 'A' as const,
      manual: false,
      bounces: 0,
      collisions: 0,
      violations: 0,
      tasksDone: true,
    };
    expect(judgeContract(resupply, { ...NO_PROGRESS, docking: docked }).met).toBe(true);
    expect(
      judgeContract(resupply, { ...NO_PROGRESS, docking: { ...docked, tasksDone: false } }).met,
    ).toBe(false);
    const tanker = { ...sat, kind: 'mars-tanker' as const, targetAltKm: null };
    const r = judgeContract(tanker, NO_PROGRESS, {
      launchDay: 1_020,
      departed: true,
      cruiseDays: 260,
      corrections: 2,
      correctionDvMS: 20,
      entrySpeedMS: 5_600,
      landing: null,
      surfaceDone: true,
      plantRunning: false,
      ice: 0.6,
      landedDay: 1_280,
      deliveredKg: 180_000,
    });
    expect(r).toMatchObject({ met: true, deliveredKg: 180_000 });
  });

  it('adds a tanker delivery to the plant stock', () => {
    const base: MarsBase = {
      siteId: 'delta-hollow',
      siteName: 'Delta Hollow',
      sinceDay: 505,
      ice: 0.6,
    };
    const after = addToPlant(base, 1_300, 180_000);
    expect(plantStockKg(after, 1_300)).toBe(plantStockKg(base, 1_300) + 180_000);
  });
});

describe('contract missions in Mission Control', () => {
  const VCTX = { unlockedPartIds: new Set<string>(), budgetCredits: 1e9 };
  const cargoDesign = (): RocketBlueprint => {
    const bp = createCompleteStarterDesign(NOW);
    const cabin = bp.parts.find((p) => p.partId === 'crew-cabin')!;
    const r = replacePart(bp, cabin.id, 'cargo-bay', NOW);
    if (!r.ok) throw new Error(r.reason);
    const cargo = setRole(r.blueprint, 'cargo', NOW);
    const c = certify(cargo, evaluateReadiness(cargo, VCTX), false, NOW);
    if (!c.ok) throw new Error(c.reason);
    return c.blueprint;
  };
  const report = (treasury: number, withContract = true) => {
    const bp = cargoDesign();
    const { e, offer } = withSatellite();
    const r = acceptContract(e, offer.id, 0);
    if (!r.ok) throw new Error(r.reason);
    let setup = setRecovery(setupForContract(createDefaultSetup(bp.id), offer), 'platform');
    for (let i = 0; i < 200 && generateConditions(setup.conditionsSeed).overall !== 'green'; i++)
      setup = waitForNextWindow(setup);
    return evaluateMission({
      setup,
      blueprint: bp,
      vehicleReport: evaluateReadiness(bp, VCTX),
      completedMissionIds: STORY,
      calendarDay: 0,
      treasury,
      contract: withContract ? r.contract : null,
    });
  };

  it('is GO with the contract and money, and counts the climb in the Δv needed', () => {
    const r = report(1e7);
    expect(r.issues.filter((i) => i.severity === 'critical').map((i) => i.title)).toEqual([]);
    expect(r.contract?.id).toBe('T-1');
    expect(r.requiredDeltaVMs).toBeGreaterThan(findMission('contract-satellite')!.requiredDeltaVMs);
  });

  it('needs the contract, and the treasury to cover the flight', () => {
    expect(report(1e7, false).issues.map((i) => i.id)).toContain('contract-missing');
    expect(report(10_000).issues.map((i) => i.id)).toContain('treasury-short');
  });
});

describe('the economy in the store', () => {
  const st = () => useGameStore.getState();
  beforeEach(() => {
    useGameStore.setState({
      progression: {
        ...INITIAL_PROGRESSION,
        completedMissions: ['test-flight', 'orbital-flight'],
        calendarDay: 40,
      },
      mission: createDefaultSetup(null),
    });
  });

  it('accepts a contract from the board, charges the flight and pays the client', () => {
    const before = economyOf(st().progression).treasury;
    const offer = refreshBoard(initialEconomy(), 40, {
      completedMissionIds: ['orbital-flight'],
      hasMarsBase: false,
    }).board.offers[0]!;
    st().acceptContract(offer.id);
    const active = economyOf(st().progression).active!;
    expect(active.id).toBe(offer.id);
    expect(st().mission.missionId).toBe('contract-satellite');
    expect(st().mission.payloadId).toBe(offer.payloadId);
    useGameStore.setState({
      mission: {
        ...st().mission,
        commit: { designId: 'x', revision: 1, at: NOW, cost: 60_000, contractId: offer.id },
      },
    });
    const record: FlightRecord = {
      id: 'r1',
      at: NOW,
      missionId: 'contract-satellite',
      missionName: 'Satellite Deployment',
      designId: 'x',
      designName: 'X',
      result: 'success',
      summary: 'ok',
      credited: true,
      crewSafe: null,
      maxAltitudeM: 800_000,
      maxSpeedMS: 7_500,
      maxQPa: 30_000,
      durationS: 2 * 86_400,
      events: [],
      contract: { contractId: offer.id, met: true, detail: 'Released.' },
    };
    st().recordFlight(record);
    const e = economyOf(st().progression);
    expect(e.active).toBeNull();
    expect(e.history.at(-1)?.result).toBe('paid');
    expect(programDay(st().progression)).toBe(42);
    // The contract pays and the flight is charged (days 40 → 42 stay in one grant period).
    expect(e.treasury).toBe(before + offer.payout - 60_000);
    // Contract missions don't count as story missions.
    expect(st().progression.completedMissions).not.toContain('contract-satellite');
    expect(st().notice?.text).toMatch(/Contract paid/);
  });

  it('pays first-time story rewards into the treasury and expires contracts while waiting', () => {
    const before = economyOf(st().progression).treasury;
    useGameStore.setState({ mission: { ...st().mission, commit: null } });
    st().recordFlight({
      id: 'r2',
      at: NOW,
      missionId: 'station-docking',
      missionName: 'Station',
      designId: 'x',
      designName: 'X',
      result: 'success',
      summary: 'ok',
      credited: true,
      crewSafe: true,
      maxAltitudeM: 400_000,
      maxSpeedMS: 7_700,
      maxQPa: 30_000,
      durationS: 3 * 86_400,
      events: [],
    });
    expect(economyOf(st().progression).treasury).toBe(
      before + findMission('station-docking')!.rewardCredits,
    );
    const offer = economyOf(st().progression).board.offers[0]!;
    st().acceptContract(offer.id);
    const deadline = economyOf(st().progression).active!.deadlineDay;
    st().waitForMarsWindow(deadline + 1);
    expect(economyOf(st().progression).active).toBeNull();
    expect(economyOf(st().progression).history.at(-1)?.result).toBe('expired');
    expect(st().notice?.text).toMatch(/expired/);
  });
});

function contractRuntime(
  missionId: string,
  payloadKg: number,
  contract: FlightContract,
  lunar?: unknown,
) {
  const bp = createCompleteStarterDesign(NOW);
  const vehicle = deriveFlightVehicle(bp, payloadKg);
  const lc: LaunchContext = {
    outcome: {
      id: 'k1',
      at: NOW,
      missionId,
      missionName: missionId,
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
    flightContextFromLaunch(
      lc,
      simulateAscent(lc.config, SIM_DT_S),
      null,
      undefined,
      lunar as Parameters<typeof flightContextFromLaunch>[4],
      undefined,
      contract,
    ),
  );
  const frames = (n: number, until: () => boolean) => {
    for (let i = 0; i < n && !until(); i++) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      rt.update(0.1);
    }
  };
  return { rt, records, frames };
}

describe('contract flights', () => {
  it('raises the orbit, releases the satellite in tolerance and comes home', () => {
    const c: FlightContract = {
      id: 'S1',
      kind: 'satellite',
      title: 'Deploy',
      client: 'Northline Telecom',
      targetAltKm: 800,
      toleranceKm: 50,
      payloadKg: 9_000,
      payout: 150_000,
    };
    const { rt, records, frames } = contractRuntime('contract-satellite', 9_000, c);
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.releaseAvailability().ok).toBe(false);
    expect(rt.releasePayload().ok).toBe(false);
    expect(rt.engage('raise-orbit').ok).toBe(true);
    frames(100_000, () => rt.current.program.program === 'none');
    const s = rt.liveState!;
    const el = orbitalElements(s.r, s.v);
    expect(Math.abs(el.apoapsisAltM / 1000 - 800)).toBeLessThan(50);
    expect(Math.abs(el.periapsisAltM / 1000 - 800)).toBeLessThan(50);
    const dry = rt.current.context!.spec.stage.dryMassKg;
    expect(rt.releasePayload().ok).toBe(true);
    expect(rt.current.context!.spec.stage.dryMassKg).toBe(dry - 9_000);
    expect(rt.engage('raise-orbit').ok).toBe(false);
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'success', credited: true });
    expect(records[0]!.contract).toMatchObject({ contractId: 'S1', met: true });
  }, 120_000);

  it('unloads a pallet at the lunar depot without taking propellant, and comes home', () => {
    const c: FlightContract = {
      id: 'L1',
      kind: 'lunar-depot',
      title: 'Depot',
      client: 'Selene Logistics',
      targetAltKm: null,
      toleranceKm: 0,
      payloadKg: 10_000,
      payout: 320_000,
    };
    const { rt, records, frames } = contractRuntime('contract-lunar-depot', 10_000, c, {
      goal: 'capture',
      landing: false,
      refuel: { leo: true, depot: false },
      depotDelivery: true,
    });
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.lunar?.refuelLeo);
    expect(rt.engage('translunar').ok).toBe(true);
    frames(
      40_000,
      () => !!rt.current.progress.lunar?.lunarOrbit && rt.current.program.program === 'none',
    );
    const prop = rt.liveState!.propKg;
    expect(rt.refuel().ok).toBe(true);
    frames(50_000, () => !!rt.current.progress.lunar?.refuelDepot);
    expect(rt.liveState!.propKg).toBeLessThanOrEqual(prop);
    expect(rt.engage('trans-earth').ok).toBe(true);
    frames(60_000, () => rt.current.program.program === 'none' || rt.liveState!.phase !== 'flight');
    rt.setZone('rtls');
    expect(rt.engage('deorbit').ok).toBe(true);
    frames(200_000, () => rt.current.phase === 'debrief');
    expect(records[0]).toMatchObject({ result: 'success', credited: true });
    expect(records[0]!.contract).toMatchObject({ contractId: 'L1', met: true });
  }, 240_000);
});

describe('economy saves', () => {
  it('migrates v8 saves to a treasury that reflects the missions flown', () => {
    const r = migrateSave({
      saveVersion: 8,
      progression: { milestones: [], tech: [], completedMissions: ['a', 'b'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.saveVersion).toBe(9);
    expect(r.data.progression).toMatchObject({
      economy: { treasury: 700_000, reputation: 26, active: null },
    });
  });

  it('round-trips the board and the active contract, dropping damaged offers', () => {
    const bp = createCompleteStarterDesign(NOW);
    const { e, offer } = withSatellite();
    const r = acceptContract(
      { ...e, board: { period: 0, offers: [offer, { ...offer, id: 'T-9' }] } },
      offer.id,
      5,
    );
    if (!r.ok) throw new Error(r.reason);
    const economy = {
      ...r.economy,
      board: {
        period: 0,
        offers: [...r.economy.board.offers, { ...offer, id: 'bad', payloadId: 'nope' }],
      },
    };
    const data: Omit<SaveData, 'saveVersion'> = {
      savedAt: NOW,
      activeBlueprintId: bp.id,
      blueprints: [bp],
      progression: { ...INITIAL_PROGRESSION, calendarDay: 5, economy },
      mission: null,
      ui: DEFAULT_UI,
      flights: [],
      fleet: [],
    };
    const loaded = parseSave(serializeSave(data));
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') return;
    const back = loaded.data.progression.economy!;
    expect(back.active).toEqual(r.contract);
    expect(back.board.offers.map((o) => o.id)).toEqual(['T-9']);
    expect(back.treasury).toBe(e.treasury);
  });
});
