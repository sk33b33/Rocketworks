import { beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../src/app/gameState';
import { selectGuide, selectProgram, useGameStore } from '../src/app/gameStore';
import { INITIAL_PROGRESSION } from '../src/progression/research';
import { validateBlueprint } from '../src/rocket/assembly/validation';
import { commitBlueprint } from '../src/app/store/commit';
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
    history: { past: [], future: [] },
    selection: null,
    notice: null,
    vehicleTab: 'stats',
  });
}

describe('navigate', () => {
  it('rejects locked locations with a reason and keeps the current one', () => {
    const result = navigate('factory', 'launch-pad');
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
