import { describe, expect, it } from 'vitest';
import { removePart } from '../src/rocket/assembly/operations';
import {
  createCompleteStarterDesign,
  createEmptyBlueprint,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import {
  autoCompleteStep,
  evaluateGuide,
  STARTER_GUIDE,
} from '../src/rocket/tutorial/starterGuide';

const NOW = '2026-01-01T00:00:00.000Z';

describe('starter guide', () => {
  it('starts at the booster engines step with the base already placed', () => {
    const g = evaluateGuide(createStarterBlueprint(NOW));
    expect(g.currentStep?.id).toBe('booster-engines');
    expect(g.requiredDone).toBe(1);
    expect(g.completeness).toBeCloseTo(1 / g.requiredTotal);
  });

  it('starts at placing the base on an empty stand', () => {
    expect(evaluateGuide(createEmptyBlueprint(NOW)).currentStep?.id).toBe('booster-base');
  });

  it('the complete design finishes every step', () => {
    const g = evaluateGuide(createCompleteStarterDesign(NOW));
    expect(g.currentStep).toBeNull();
    expect(g.completeness).toBe(1);
  });

  it('auto-complete puts ship engines on the ship only', () => {
    let bp = createCompleteStarterDesign(NOW);
    const aft = bp.parts.find((p) => p.partId === 'ship-aft-section')!;
    const shipEngine = bp.parts.find(
      (p) => p.partId === 'engine-sl' && p.parent.parentId === aft.id,
    )!;
    const r1 = removePart(bp, shipEngine.id, NOW);
    if (!r1.ok) throw new Error();
    bp = r1.blueprint;
    const step = STARTER_GUIDE.find((s) => s.id === 'ship-engines')!;
    expect(step.isDone(bp)).toBe(false);
    const r2 = autoCompleteStep(bp, step, NOW);
    expect(r2.ok && r2.attached).toBe(1);
  });

  it('auto-complete explains when the stack is blocked', () => {
    let bp = createCompleteStarterDesign(NOW);
    const tank = bp.parts.find(
      (p) =>
        p.partId === 'booster-tank' && p.parent.socketId === 'top' && p.parent.parentId !== 'p1',
    );
    // Remove a middle tank's subtree; then re-add the forward section directly so tanks are blocked.
    const r = removePart(bp, tank!.id, NOW);
    if (!r.ok) throw new Error();
    bp = r.blueprint;
    const fwd = autoCompleteStep(
      bp,
      STARTER_GUIDE.find((s) => s.id === 'booster-forward')!,
      NOW,
    );
    if (!fwd.ok) throw new Error(fwd.reason);
    const tanks = autoCompleteStep(
      fwd.blueprint,
      STARTER_GUIDE.find((s) => s.id === 'booster-tanks')!,
      NOW,
    );
    expect(tanks.ok).toBe(false);
    if (!tanks.ok) expect(tanks.reason).toMatch(/bottom-up/);
  });
});
