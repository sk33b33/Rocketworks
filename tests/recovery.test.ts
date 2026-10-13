import { describe, expect, it } from 'vitest';
import { useGameStore } from '../src/app/gameStore';
import { applyFleetOutcome } from '../src/app/store/flightSlice';
import {
  compatibleVehicles,
  FLEET,
  isRetired,
  recordLoss,
  recordRecovery,
  refurbish,
  stageCost,
  stageFlightCost,
  type FleetVehicle,
} from '../src/fleet/fleet';
import type { FlightRecord } from '../src/launch/flightRecord';
import { LaunchRuntime, type LaunchContext } from '../src/launch/launchRuntime';
import { evaluateMission } from '../src/missions/missionReadiness';
import { createDefaultSetup, type MissionSetup } from '../src/missions/missionSetup';
import { MILESTONES } from '../src/progression/milestones';
import { initialBoosterState } from '../src/recovery/boosterModel';
import { simulateAssistedRecovery } from '../src/recovery/boosterGuidance';
import { gradeAtLeast, rateLanding } from '../src/recovery/rating';
import {
  boosterHardware,
  CATCH_WINDOW,
  defaultRecoveryTarget,
  deriveBoosterSpec,
  recoveryAvailability,
  RESERVE_FRACTION,
  stageSignature,
  type RecoveryTarget,
} from '../src/recovery/recoveryPlan';
import { RecoverySession, unrecoveredSummary } from '../src/recovery/recoverySession';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { instanceStages } from '../src/rocket/stats/calculateRocketStats';
import { simulateAscent, type AscentTarget } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';
const bp = createCompleteStarterDesign(NOW);
const vehicle = deriveFlightVehicle(bp, 300);
const spec = deriveBoosterSpec(bp, vehicle.booster);
const ORBIT: AscentTarget = { kind: 'orbit', altitudeM: 150_000 };

function staging(target: RecoveryTarget, ascent: AscentTarget = ORBIT) {
  const s = simulateAscent(
    {
      vehicle,
      target: ascent,
      failures: [],
      boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION[target],
    },
    SIM_DT_S,
  );
  return { ascent: s, staging: s.staging! };
}

/** The design without booster legs or grid fins. */
function stripped(partIds: string[]): RocketBlueprint {
  const drop = new Set(bp.parts.filter((p) => partIds.includes(p.partId)).map((p) => p.id));
  return {
    ...bp,
    parts: bp.parts.filter((p) => !drop.has(p.id) && !drop.has(p.parent.parentId ?? '')),
  };
}

describe('recovery planning', () => {
  it('needs grid fins to catch and legs to land on the platform', () => {
    const hw = boosterHardware(bp);
    expect(hw).toEqual({ gridFins: 4, boosterLegs: 4 });
    expect(defaultRecoveryTarget(hw)).toBe('catch');
    expect(recoveryAvailability('platform', { gridFins: 4, boosterLegs: 2 }).ok).toBe(false);
    expect(recoveryAvailability('catch', { gridFins: 4, boosterLegs: 0 }).ok).toBe(true);
    expect(defaultRecoveryTarget({ gridFins: 0, boosterLegs: 4 })).toBe('expend');
    const noLegs = boosterHardware(stripped(['landing-leg']));
    expect(defaultRecoveryTarget(noLegs)).toBe('catch');
  });

  it('holds back propellant at staging for the recovery', () => {
    const expend = staging('expend').staging;
    const caught = staging('catch').staging;
    expect(expend.boosterPropKg).toBeLessThan(1);
    expect(caught.boosterPropKg).toBeCloseTo(
      vehicle.booster.propellantKg * RESERVE_FRACTION.catch,
      -2,
    );
    // Staging earlier and slower is the cost of bringing the booster home.
    expect(caught.vHorizMS).toBeLessThan(expend.vHorizMS);
  });

  it('signs the booster independently of ship changes', () => {
    const stages = instanceStages(bp);
    const shipLeaf = bp.parts.find(
      (p) => stages.get(p.id) === 'ship' && !bp.parts.some((c) => c.parent.parentId === p.id),
    )!;
    const edited = { ...bp, parts: bp.parts.filter((p) => p.id !== shipLeaf.id) };
    expect(stageSignature(edited, 'booster')).toBe(stageSignature(bp, 'booster'));
    expect(stageSignature(edited, 'ship')).not.toBe(stageSignature(bp, 'ship'));
    expect(stageSignature(stripped(['grid-fin']), 'booster')).not.toBe(
      stageSignature(bp, 'booster'),
    );
  });
});

describe('assisted booster recovery', () => {
  it('catches the booster with the tower arms inside the capture window', () => {
    const start = initialBoosterState(staging('catch').staging, spec);
    const end = simulateAssistedRecovery(start, spec, { mode: 'catch', x: 0 });
    expect(end.phase).toBe('caught');
    expect(Math.abs(end.contact!.missM)).toBeLessThanOrEqual(CATCH_WINDOW.missM);
    expect(end.contact!.vertMS).toBeLessThanOrEqual(CATCH_WINDOW.vertMS);
  });

  it('lands on the platform stationed where the profile ends', () => {
    const session = new RecoverySession(staging('platform').staging, spec, 'platform');
    expect(session.target.x).toBeGreaterThan(100_000);
    session.skip();
    const summary = session.summary(true);
    expect(summary).toMatchObject({ outcome: 'landed', simulated: true, target: 'platform' });
    expect(gradeAtLeast(summary.grade, 'B')).toBe(true);
  });

  it('crashes without propellant for the landing burn', () => {
    const st = { ...staging('catch').staging, boosterPropKg: 20_000 };
    const session = new RecoverySession(st, spec, 'catch');
    session.skip();
    expect(session.summary(true).outcome).toBe('lost');
    expect(session.summary(true).grade).toBeNull();
  });

  it('hands the landing burn to the player on request', () => {
    const session = new RecoverySession(staging('platform').staging, spec, 'platform');
    expect(session.manualAvailable).toBe(false);
    session.setManual(true);
    let i = 0;
    while (!session.view().manualActive && !session.done && i++ < 20_000)
      session.step(SIM_DT_S, SIM_DT_S);
    expect(session.view().manualActive).toBe(true);
    // Full thrust held: the player is flying and the descent slows.
    const vyStart = session.view().state.vy;
    session.setThrottle(1);
    session.setKey('throttle-up', true);
    for (let k = 0; k < 40; k++) session.step(SIM_DT_S, SIM_DT_S);
    expect(session.view().manualInput.throttle).toBe(1);
    expect(session.view().state.vy).toBeGreaterThan(vyStart + 20);
  });

  it('only credits a manual landing when the player flew the whole burn', () => {
    const session = new RecoverySession(staging('platform').staging, spec, 'platform');
    session.setManual(true);
    let i = 0;
    while (!session.view().manualActive && i++ < 20_000) session.step(SIM_DT_S, SIM_DT_S);
    for (let k = 0; k < 5; k++) session.step(SIM_DT_S, SIM_DT_S);
    session.setManual(false); // hand back to the assist mid-burn
    session.skip();
    expect(session.summary(false)).toMatchObject({ outcome: 'landed', manual: false });
  });

  it('summarizes expended and unattempted recoveries', () => {
    expect(unrecoveredSummary('expend', 'expended')).toMatchObject({
      outcome: 'expended',
      grade: null,
    });
    expect(unrecoveredSummary('catch', 'not-attempted').outcome).toBe('not-attempted');
  });
});

describe('landing rating', () => {
  it('grades precision from S to D', () => {
    const limits = { missM: 12, vertMS: 4, horizMS: 3, tiltDeg: 8 };
    expect(rateLanding({ missM: 0, vertMS: 0.5, horizMS: 0, tiltDeg: 0 }, limits).grade).toBe('S');
    expect(rateLanding({ missM: 6, vertMS: 2, horizMS: 1.5, tiltDeg: 4 }, limits).grade).toBe('C');
    expect(rateLanding({ missM: 12, vertMS: 4, horizMS: 3, tiltDeg: 8 }, limits).grade).toBe('D');
    expect(gradeAtLeast('A', 'B')).toBe(true);
    expect(gradeAtLeast('C', 'B')).toBe(false);
    expect(gradeAtLeast(null, 'D')).toBe(false);
  });
});

describe('fleet', () => {
  const base = (over: Partial<FleetVehicle> = {}): FleetVehicle => ({
    id: 'fv-1',
    kind: 'booster',
    name: 'B-1',
    designId: bp.id,
    designName: bp.name,
    signature: stageSignature(bp, 'booster'),
    flights: 1,
    wear: 0.1,
    lastGrade: 'S',
    recoveredAt: NOW,
    refurbPending: false,
    ...over,
  });

  it('prices reflights well below a new build, rising with wear and refurbishment', () => {
    const cost = stageCost(bp, 'booster');
    expect(cost + stageCost(bp, 'ship')).toBeGreaterThan(0);
    const fresh = stageFlightCost(cost, base({ wear: 0 }));
    expect(fresh).toBeLessThan(cost * 0.2);
    expect(stageFlightCost(cost, base({ wear: 0.5 }))).toBeGreaterThan(fresh);
    expect(stageFlightCost(cost, base({ wear: 0, refurbPending: true }))).toBeGreaterThan(fresh);
    expect(stageFlightCost(cost, base({ wear: 0 }), true)).toBeLessThan(fresh);
    expect(stageFlightCost(cost, null)).toBe(cost);
  });

  it('adds, updates, wears out and loses vehicles', () => {
    const input = {
      kind: 'booster' as const,
      bp,
      at: NOW,
      grade: 'A' as const,
      stress: 0,
      reflownId: null,
    };
    const first = recordRecovery([], input, 'fv-1');
    expect(first.vehicle).toMatchObject({ name: 'B-1', flights: 1 });
    const second = recordRecovery(first.fleet, input, 'fv-2');
    expect(second.vehicle.name).toBe('B-2');
    const again = recordRecovery(
      second.fleet,
      { ...input, reflownId: 'fv-1', grade: 'D', stress: 1 },
      'x',
    );
    expect(again.fleet).toHaveLength(2);
    expect(again.vehicle).toMatchObject({ id: 'fv-1', flights: 2 });
    expect(again.vehicle.wear).toBeGreaterThan(first.vehicle.wear + 0.2);
    expect(recordLoss(again.fleet, 'fv-2').map((v) => v.id)).toEqual(['fv-1']);
    const worn = base({ wear: 1 });
    expect(isRetired(worn)).toBe(true);
    expect(compatibleVehicles([worn], bp, 'booster')).toEqual([]);
    expect(refurbish([worn], 'fv-1')[0]).toMatchObject({ wear: 0, refurbPending: true });
    expect(compatibleVehicles([base()], stripped(['grid-fin']), 'booster')).toEqual([]);
    expect(FLEET.maxVehicles).toBeGreaterThan(4);
  });
});

describe('mission readiness with recovery and fleet', () => {
  const setup = (over: Partial<MissionSetup> = {}): MissionSetup => ({
    ...createDefaultSetup(bp.id),
    missionId: 'test-flight',
    ...over,
  });
  const report = (
    s: MissionSetup,
    extra: { fleet?: FleetVehicle[]; budgetCredits?: number; design?: RocketBlueprint } = {},
  ) =>
    evaluateMission({
      setup: s,
      blueprint: extra.design ?? bp,
      vehicleReport: undefined,
      completedMissionIds: [],
      ...(extra.fleet ? { fleet: extra.fleet } : {}),
      ...(extra.budgetCredits !== undefined ? { budgetCredits: extra.budgetCredits } : {}),
    });
  const ids = (r: ReturnType<typeof report>) => r.issues.map((i) => i.id);

  it('resolves the recovery plan and charges its propellant reserve to Δv', () => {
    const auto = report(setup());
    expect(auto.recovery).toBe('catch');
    const expend = report(setup({ recovery: 'expend' }));
    expect(expend.deltaV!.totalMs).toBeGreaterThan(auto.deltaV!.totalMs);
    expect(
      ids(report(setup({ recovery: 'platform' }), { design: stripped(['landing-leg']) })),
    ).toContain('recovery-hardware');
  });

  it('enforces the budget per mission and credits reflown hardware', () => {
    const newCost = stageCost(bp, 'booster') + stageCost(bp, 'ship');
    const tight = newCost - 10_000;
    expect(ids(report(setup(), { budgetCredits: tight }))).toContain('mission-over-budget');
    const booster: FleetVehicle = {
      id: 'fv-1',
      kind: 'booster',
      name: 'B-1',
      designId: bp.id,
      designName: bp.name,
      signature: stageSignature(bp, 'booster'),
      flights: 1,
      wear: 0.6,
      lastGrade: 'S',
      recoveredAt: NOW,
      refurbPending: false,
    };
    const reflown = report(setup({ boosterFleetId: 'fv-1' }), {
      budgetCredits: tight,
      fleet: [booster],
    });
    expect(ids(reflown)).not.toContain('mission-over-budget');
    expect(ids(reflown)).toContain('fleet-wear-booster');
    expect(reflown.cost.missionCredits).toBeLessThan(newCost);
    expect(reflown.risk.score).toBeGreaterThan(report(setup()).risk.score);
    expect(ids(report(setup({ boosterFleetId: 'gone' }), { fleet: [] }))).toContain(
      'fleet-missing-booster',
    );
    expect(
      ids(
        report(setup({ boosterFleetId: 'fv-1' }), {
          fleet: [booster],
          design: stripped(['grid-fin']),
        }),
      ),
    ).toContain('fleet-mismatch-booster');
  });
});

describe('launch runtime with recovery', () => {
  function context(missionId: string, recovery: RecoveryTarget): LaunchContext {
    return {
      outcome: {
        id: 'f1',
        at: NOW,
        missionId,
        missionName: 'M',
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
        target:
          missionId === 'test-flight'
            ? { kind: 'suborbital', secoSpeedMS: 5600, minApogeeM: 100_000 }
            : ORBIT,
        failures: [],
        boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION[recovery],
      },
      recovery,
      boosterSpec: spec,
      hardware: { boosterId: 'fv-9', shipId: null },
    };
  }
  const fly = (rt: LaunchRuntime, until: (p: string) => boolean) => {
    rt.startCountdown();
    rt.skipToTerminalCount();
    for (let t = 0; t < 2_000 && !until(rt.current.phase); t += 0.1) {
      if (rt.current.phase === 'ascent' || rt.current.phase === 'recovery') rt.setWarp(10);
      rt.update(0.1);
    }
  };

  it('replays the booster recovery, then debriefs a suborbital flight with it', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context('test-flight', 'catch'), true);
    fly(rt, (p) => p === 'recovery');
    expect(rt.current.phase).toBe('recovery');
    expect(rt.liveRecovery?.target.mode).toBe('catch');
    rt.skipRecovery();
    fly(rt, (p) => p === 'debrief');
    expect(records).toHaveLength(1);
    expect(records[0]!.recovery).toMatchObject({ outcome: 'caught', simulated: true });
    expect(records[0]!.hardware).toEqual({ boosterId: 'fv-9', shipId: null });
  });

  it('hands an orbital mission to the flight runtime with the recovery result', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context('orbital-flight', 'platform'), true);
    fly(rt, (p) => p === 'handoff');
    expect(rt.current.phase).toBe('handoff');
    expect(rt.current.recoveryResult?.outcome).toBe('landed');
    expect(records).toHaveLength(0);
  });

  it('expends the booster without a replay when planned', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context('test-flight', 'expend'), true);
    fly(rt, (p) => p === 'debrief');
    expect(records[0]!.recovery?.outcome).toBe('expended');
  });
});

describe('recording recovered hardware', () => {
  const record = (over: Partial<FlightRecord>): FlightRecord => ({
    id: `r-${Math.random()}`,
    at: NOW,
    missionId: 'test-flight',
    missionName: 'Hop',
    designId: bp.id,
    designName: bp.name,
    result: 'success',
    summary: 'ok',
    credited: false,
    crewSafe: null,
    maxAltitudeM: 1,
    maxSpeedMS: 1,
    maxQPa: 1,
    durationS: 1,
    events: [],
    ...over,
  });
  const caught = {
    target: 'catch' as const,
    outcome: 'caught' as const,
    grade: 'S' as const,
    manual: true,
    simulated: false,
    missM: 0,
    vertMS: 1.5,
    heatLoadMJm2: 1.2,
    summary: 'Caught.',
  };

  it('adds recovered boosters, removes lost reflown ones', () => {
    const add = applyFleetOutcome([], record({ recovery: caught }), bp);
    expect(add.fleet).toHaveLength(1);
    expect(add.text).toMatch(/B-1 recovered \(rating S\)/);
    const id = add.fleet[0]!.id;
    const lost = applyFleetOutcome(
      add.fleet,
      record({
        recovery: { ...caught, outcome: 'lost', grade: null },
        hardware: { boosterId: id, shipId: null },
      }),
      bp,
    );
    expect(lost.fleet).toEqual([]);
  });

  it('records the flight in the store: fleet, milestones and released assignments', () => {
    useGameStore.setState({
      blueprints: [bp],
      flights: [],
      fleet: [],
      mission: {
        ...createDefaultSetup(bp.id),
        boosterFleetId: 'x',
        commit: { designId: bp.id, revision: 1, at: NOW },
      },
      progression: { milestones: [], tech: [], completedMissions: [] },
    });
    useGameStore.getState().recordFlight(record({ recovery: caught }));
    const s = useGameStore.getState();
    expect(s.fleet).toHaveLength(1);
    expect(s.mission.boosterFleetId).toBeNull();
    expect(s.mission.commit).toBeNull();
    expect(s.progression.milestones).toEqual(expect.arrayContaining(['first-catch', 'manual-ace']));
    expect(MILESTONES.some((m) => m.id === 'flight-proven')).toBe(true);
  });
});
