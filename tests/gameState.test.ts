import { beforeEach, describe, expect, it } from 'vitest';
import { navigate } from '../src/app/gameState';
import { selectGuide, useGameStore } from '../src/app/gameStore';
import { validateBlueprint } from '../src/rocket/assembly/validation';

describe('navigate', () => {
  it('rejects locked locations with a reason and keeps the current one', () => {
    const result = navigate('factory', 'launch-pad');
    expect(result.ok).toBe(false);
    expect(result.location).toBe('factory');
    if (!result.ok) expect(result.reason).toContain('later stage');
  });

  it('allows the factory', () => {
    expect(navigate('factory', 'factory')).toEqual({ ok: true, location: 'factory' });
  });
});

describe('game store', () => {
  beforeEach(() => {
    useGameStore.getState().resetBuild();
    useGameStore.getState().clearSelection();
  });

  it('starts at the factory with the starter build', () => {
    const s = useGameStore.getState();
    expect(s.currentLocation).toBe('factory');
    expect(s.blueprint.parts.map((p) => p.partId)).toEqual(['booster-engine-section']);
  });

  it('warns on rejected navigation without changing location', () => {
    expect(useGameStore.getState().goTo('moon')).toBe(false);
    expect(useGameStore.getState().notice?.tone).toBe('warning');
    expect(useGameStore.getState().currentLocation).toBe('factory');
  });

  it('attaches the selected catalog part to a socket and reports step completion', () => {
    const s = useGameStore.getState();
    s.selectCatalogPart('booster-tank');
    expect(s.attachSelectedTo({ parentId: 'p1', socketId: 'top' })).toBe(true);
    expect(useGameStore.getState().blueprint.parts).toHaveLength(2);
    // Selection stays on the catalog part so several can be placed in a row.
    expect(useGameStore.getState().selection).toEqual({ kind: 'catalog', partId: 'booster-tank' });
  });

  it('rejects an incompatible socket with a warning', () => {
    const s = useGameStore.getState();
    s.selectCatalogPart('grid-fin');
    expect(s.attachSelectedTo({ parentId: 'p1', socketId: 'engine-inner-1' })).toBe(false);
    expect(useGameStore.getState().notice?.text).toMatch(/grid-fin actuator/);
    expect(useGameStore.getState().blueprint.parts).toHaveLength(1);
  });

  it('fill, remove and guide auto-complete keep the blueprint valid', () => {
    const s = useGameStore.getState();
    s.selectCatalogPart('engine-sl');
    s.fillSelected();
    expect(useGameStore.getState().notice?.text).toMatch(/Step complete/);
    s.runGuideStep('booster-tanks');
    const bp = useGameStore.getState().blueprint;
    expect(bp.parts.filter((p) => p.partId === 'booster-tank')).toHaveLength(3);
    const firstTank = bp.parts.find((p) => p.partId === 'booster-tank')!;
    s.selectInstance(firstTank.id);
    s.removeInstance(firstTank.id);
    const after = useGameStore.getState();
    expect(after.selection).toBeNull();
    expect(after.blueprint.parts.filter((p) => p.partId === 'booster-tank')).toHaveLength(0);
    expect(validateBlueprint(after.blueprint).valid).toBe(true);
  });

  it('loads the reference design to 100% completeness', () => {
    useGameStore.getState().loadReferenceDesign();
    expect(selectGuide(useGameStore.getState()).completeness).toBe(1);
  });
});
