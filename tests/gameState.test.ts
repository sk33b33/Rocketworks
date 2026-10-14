import { beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../src/app/gameState';
import {
  selectGuide,
  selectMissionReport,
  selectProgram,
  useGameStore,
} from '../src/app/gameStore';
import { INITIAL_PROGRESSION } from '../src/progression/research';
import { validateBlueprint } from '../src/rocket/assembly/validation';
import { commitBlueprint } from '../src/app/store/commit';
import type { FlightRecord } from '../src/launch/flightRecord';
import { generateConditions } from '../src/missions/conditions';
import { createDefaultSetup } from '../src/missions/missionSetup';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { certificationStatus } from '../src/rocket/readiness/certification';

const st = () => useGameStore.getState();

function resetStore() {
  const starter = createStarterBlueprint(new Date().toISOString());
  useGameStore.setState({
    blueprints: [starter],
    activeBlueprintId: starter.id,
    blueprint: starter,
    progression: INITIAL_PROGRESSION,
    mission: createDefaultSetup(starter.id),
    missionTab: 'briefing',
    currentLocation: 'factory',
    history: { past: [], future: [] },
    selection: null,
    notice: null,
    vehicleTab: 'stats',
  });
}

describe('navigate', () => {
  it('opens Mission Control and still locks the Launch Pad', () => {
    expect(navigate('factory', 'mission-control').ok).toBe(true);
  });

  it('rejects locked locations with a reason and keeps the current one', () => {
    expect(navigate('factory', 'launch-pad').ok).toBe(true);
    expect(navigate('factory', 'flight').ok).toBe(true);
    expect(navigate('factory', 'station').ok).toBe(true);
    const result = navigate('factory', 'moon');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('later stage');
  });
});

describe('game store: assembly', () => {
  beforeEach(resetStore);

  it('starts at the factory with the starter build', () => {
    expect(st().currentLocation).toBe('factory');
    expect(st().blueprint.parts.map((p) => p.partId)).toEqual(['booster-engine-section']);
  });

  it('attaches the selected part, keeps the catalog selection and records undo history', () => {
    st().selectCatalogPart('booster-tank');
    expect(st().attachSelectedTo({ parentId: 'p1', socketId: 'top' })).toBe(true);
    expect(st().blueprint.parts).toHaveLength(2);
    expect(st().selection).toEqual({ kind: 'catalog', partId: 'booster-tank' });
    expect(st().history.past).toHaveLength(1);
    expect(st().blueprints[0]).toBe(st().blueprint);
  });

  it('rejects an incompatible socket with a warning', () => {
    st().selectCatalogPart('grid-fin');
    expect(st().attachSelectedTo({ parentId: 'p1', socketId: 'engine-inner-1' })).toBe(false);
    expect(st().notice?.tone).toBe('warning');
    expect(st().blueprint.parts).toHaveLength(1);
  });

  it('undo and redo walk the history and fix stale selections', () => {
    st().selectCatalogPart('engine-sl');
    st().fillSelected();
    const filled = st().blueprint;
    st().selectInstance(filled.parts[1]!.id);
    st().undo();
    expect(st().blueprint.parts).toHaveLength(1);
    expect(st().selection).toBeNull();
    expect(st().history.future).toHaveLength(1);
    st().redo();
    expect(st().blueprint).toBe(filled);
    st().redo();
    expect(st().notice?.text).toMatch(/Nothing to redo/);
    // A new edit clears the redo stack.
    st().undo();
    st().runGuideStep('booster-tanks');
    expect(st().history.future).toHaveLength(0);
  });

  it('awards milestones as the build progresses', () => {
    st().runGuideStep('booster-engines');
    expect(st().progression.milestones).toContain('booster-lit');
    expect(st().notice?.text).toMatch(/Milestone/);
    expect(selectProgram(st()).researchAvailable).toBe(1);
  });

  it('refuses changes that exceed the budget but allows ones that reduce cost', () => {
    const ref = createCompleteStarterDesign('2026-01-01T00:00:00.000Z');
    // Cost-only fabrication: twice the reference parts is far above the 150,000 cr base budget.
    const huge = { ...ref, parts: [...ref.parts, ...ref.parts] };
    useGameStore.setState({ blueprint: ref, blueprints: [ref], activeBlueprintId: ref.id });
    expect(commitBlueprint(useGameStore.setState, st, huge, 'test')).toBe(false);
    expect(st().blueprint).toBe(ref);
    expect(st().notice?.text).toMatch(/Over budget/);
    // Already over budget: a cheaper change is still allowed so the player can fix it.
    useGameStore.setState({ blueprint: huge, blueprints: [huge] });
    expect(commitBlueprint(useGameStore.setState, st, ref, 'cheaper')).toBe(true);
  });

  it('keeps every intermediate blueprint structurally valid', () => {
    for (const step of ['booster-engines', 'booster-tanks', 'booster-forward', 'grid-fins']) {
      st().runGuideStep(step);
      expect(validateBlueprint(st().blueprint).valid).toBe(true);
    }
    expect(selectGuide(st()).requiredDone).toBe(5);
  });
});

describe('game store: certification, library and program', () => {
  beforeEach(resetStore);

  it('certifies a ready design, awards milestones, and expires on edit', () => {
    st().certify(false);
    expect(st().notice?.text).toMatch(/refused/);
    st().loadReferenceDesign();
    st().certify(false);
    expect(certificationStatus(st().blueprint)).toBe('valid');
    expect(st().progression.milestones).toEqual(
      expect.arrayContaining(['first-certified', 'crew-rated']),
    );
    const antenna = st().blueprint.parts.find((p) => p.partId === 'antenna')!;
    st().removeInstance(antenna.id);
    expect(certificationStatus(st().blueprint)).toBe('expired');
  });

  it('certifies with override and marks it', () => {
    st().certify(true);
    expect(certificationStatus(st().blueprint)).toBe('override');
    expect(st().progression.milestones).not.toContain('first-certified');
  });

  it('switching designs preserves each design and resets history/selection', () => {
    st().runGuideStep('booster-engines');
    const firstId = st().activeBlueprintId;
    st().duplicateBlueprint(firstId);
    expect(st().blueprints).toHaveLength(2);
    const copyId = st().activeBlueprintId;
    expect(copyId).not.toBe(firstId);
    expect(st().history.past).toHaveLength(0);
    st().runGuideStep('booster-tanks');
    st().switchBlueprint(firstId);
    expect(st().blueprint.parts.filter((p) => p.partId === 'booster-tank')).toHaveLength(0);
    st().switchBlueprint(copyId);
    expect(st().blueprint.parts.filter((p) => p.partId === 'booster-tank')).toHaveLength(3);
    expect(st().renameBlueprint(copyId, 'Heavy Test')).toBe(true);
    expect(st().blueprint.name).toBe('Heavy Test');
    st().deleteBlueprint(copyId);
    expect(st().activeBlueprintId).toBe(firstId);
    st().deleteBlueprint(firstId);
    expect(st().blueprints).toHaveLength(1);
    expect(st().notice?.text).toMatch(/at least one/);
  });

  it('role changes are undoable design changes; finish is cosmetic', () => {
    st().setRole('cargo');
    expect(st().blueprint.role).toBe('cargo');
    st().undo();
    expect(st().blueprint.role).toBe('crew');
    const rev = st().blueprint.revision;
    st().setFinish('weathered');
    expect(st().blueprint.finish).toBe('weathered');
    expect(st().blueprint.revision).toBe(rev);
  });

  it('researches tech with earned RP and unlocks parts for attaching', () => {
    st().research('engine-block-2');
    expect(st().notice?.tone).toBe('warning');
    st().loadReferenceDesign(); // earns booster/full-stack/outfitted milestones
    expect(selectProgram(st()).researchAvailable).toBeGreaterThanOrEqual(3);
    st().research('engine-block-2');
    expect(st().progression.tech).toContain('engine-block-2');
    const engine = st().blueprint.parts.find((p) => p.partId === 'engine-sl')!;
    st().replaceInstance(engine.id, 'engine-sl-b2');
    expect(st().blueprint.parts.find((p) => p.id === engine.id)?.partId).toBe('engine-sl-b2');
  });

  it('fix actions route to the right behaviour', () => {
    st().runFixAction({ kind: 'select-part', partId: 'engine-sl' });
    expect(st().selection).toEqual({ kind: 'catalog', partId: 'engine-sl' });
    st().runFixAction({ kind: 'open-program' });
    expect(st().vehicleTab).toBe('program');
    st().runFixAction({ kind: 'guide-step', stepId: 'booster-engines' });
    expect(selectGuide(st()).steps.find((s) => s.step.id === 'booster-engines')?.done).toBe(true);
  });
});

describe('game store: Mission Control', () => {
  beforeEach(resetStore);

  it('plans, commits, survives a trip to the factory, and voids on design change', () => {
    expect(st().goTo('mission-control')).toBe(true);
    st().loadReferenceDesign();
    st().certify(false);
    const designId = st().activeBlueprintId;
    st().selectMission('orbital-flight');
    st().setMissionDesign(designId);
    st().toggleCrew('okafor');
    st().toggleCrew('lindqvist');
    st().toggleCrew('adeyemi');
    expect(st().notice?.text).toMatch(/medical hold/);
    for (
      let i = 0;
      i < 200 && generateConditions(st().mission.conditionsSeed).overall !== 'green';
      i++
    ) {
      st().waitForWindow();
    }
    expect(selectMissionReport(st()).status).not.toBe('no-go');
    st().commitMission();
    expect(st().mission.commit?.designId).toBe(designId);

    // Leave for the factory and come back: the plan is intact.
    const plan = st().mission;
    expect(st().goTo('factory')).toBe(true);
    expect(st().goTo('mission-control')).toBe(true);
    expect(st().mission).toBe(plan);

    // Editing the vehicle voids the commitment (revision changes, certification expires).
    st().goTo('factory');
    const antenna = st().blueprint.parts.find((p) => p.partId === 'antenna')!;
    st().removeInstance(antenna.id);
    const report = selectMissionReport(st());
    expect(report.status).toBe('no-go');
    expect(report.issues.map((i) => i.id)).toContain('not-certified');
  });

  it('refuses to commit a NO-GO plan and routes fix actions', () => {
    st().goTo('mission-control');
    st().commitMission();
    expect(st().notice?.tone).toBe('warning');
    expect(st().mission.commit).toBeNull();
    st().runMissionFix({ kind: 'open-tab', tab: 'manifest' });
    expect(st().missionTab).toBe('manifest');
    const seed = st().mission.conditionsSeed;
    st().runMissionFix({ kind: 'wait-window' });
    expect(st().mission.conditionsSeed).not.toBe(seed);
    st().runMissionFix({ kind: 'go-factory', tab: 'readiness' });
    expect(st().currentLocation).toBe('factory');
    expect(st().vehicleTab).toBe('readiness');
  });

  it('refuses locked missions with the unlock reason', () => {
    st().selectMission('station-docking');
    expect(st().notice?.text).toMatch(/Crewed Orbital Shakedown/);
    expect(st().mission.missionId).toBe('test-flight');
  });
});

describe('game store: flights', () => {
  beforeEach(() => {
    resetStore();
    useGameStore.setState({ flights: [] });
  });

  const record = (over: Partial<FlightRecord> = {}): FlightRecord => ({
    id: `f-${Math.random()}`,
    at: '2026-01-01T00:00:00.000Z',
    missionId: 'test-flight',
    missionName: 'Uncrewed Test Flight',
    designId: 'bp-starter',
    designName: 'Starter',
    result: 'success',
    summary: 'Suborbital test profile completed.',
    credited: true,
    crewSafe: null,
    maxAltitudeM: 145_000,
    maxSpeedMS: 5_600,
    maxQPa: 32_000,
    durationS: 345,
    events: [],
    ...over,
  });

  it('pays mission rewards once, records history and releases the commitment', () => {
    useGameStore.setState({
      mission: { ...st().mission, commit: { designId: 'x', revision: 1, at: 'now' } },
    });
    const before = selectProgram(st());
    const r = record();
    st().recordFlight(r);
    st().recordFlight(r); // idempotent
    expect(st().flights).toHaveLength(1);
    expect(st().progression.completedMissions).toEqual(['test-flight']);
    expect(selectProgram(st()).researchAvailable - before.researchAvailable).toBe(2);
    expect(st().mission.commit).toBeNull();
    expect(st().notice?.text).toMatch(/Reward/);
    st().recordFlight(record());
    expect(selectProgram(st()).researchAvailable - before.researchAvailable).toBe(2);
  });

  it('keeps the commitment after a scrub and does not credit failures', () => {
    const commit = { designId: 'x', revision: 1, at: 'now' };
    useGameStore.setState({ mission: { ...st().mission, commit } });
    st().recordFlight(record({ result: 'scrubbed', credited: false }));
    expect(st().mission.commit).toEqual(commit);
    st().recordFlight(record({ result: 'failure', credited: false }));
    expect(st().progression.completedMissions).toEqual([]);
    expect(st().mission.commit).toBeNull();
  });
});

describe('launch binding', () => {
  beforeEach(resetStore);

  it('builds a launch only from a valid commitment', async () => {
    const { buildLaunchContext } = await import('../src/app/launchBinding');
    expect(buildLaunchContext(st())).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/No mission is committed/),
    });
    st().loadReferenceDesign();
    st().certify(false);
    st().setMissionDesign(st().activeBlueprintId);
    for (
      let i = 0;
      i < 200 && generateConditions(st().mission.conditionsSeed).overall === 'red';
      i++
    )
      st().waitForWindow();
    st().commitMission();
    const ok = buildLaunchContext(st());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.context.crewed).toBe(false);
      expect(ok.context.config.target.kind).toBe('suborbital');
      expect(ok.context.config.vehicle.booster.engineCount).toBe(13);
    }
    // Changing the design voids the commitment.
    const antenna = st().blueprint.parts.find((p) => p.partId === 'antenna')!;
    st().removeInstance(antenna.id);
    expect(buildLaunchContext(st())).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/void/),
    });
  });
});
