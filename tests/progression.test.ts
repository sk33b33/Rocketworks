import { describe, expect, it } from 'vitest';
import { MILESTONES, newlyAchieved } from '../src/progression/milestones';
import {
  BASE_BUDGET_CREDITS,
  budgetCredits,
  canResearch,
  INITIAL_PROGRESSION,
  purchaseTech,
  researchAvailable,
  TECH_TREE,
  unlockedPartIds,
} from '../src/progression/research';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { PARTS } from '../src/rocket/catalog/parts';
import { certify } from '../src/rocket/readiness/certification';
import { evaluateReadiness } from '../src/rocket/readiness/readiness';
import { calculateRocketStats } from '../src/rocket/stats/calculateRocketStats';

const NOW = '2026-01-01T00:00:00.000Z';

describe('research', () => {
  it('links every locked part to an existing tech node', () => {
    for (const p of PARTS.filter((x) => !x.unlock.unlocked)) {
      const techId = p.unlock.unlocked ? undefined : p.unlock.techId;
      expect(
        TECH_TREE.some((t) => t.id === techId),
        p.id,
      ).toBe(true);
    }
  });

  it('starts with the base budget, no RP and nothing unlocked', () => {
    expect(budgetCredits(INITIAL_PROGRESSION)).toBe(BASE_BUDGET_CREDITS);
    expect(researchAvailable(INITIAL_PROGRESSION)).toBe(0);
    expect(unlockedPartIds(INITIAL_PROGRESSION).size).toBe(0);
  });

  it('the reference design fits the starting budget', () => {
    expect(calculateRocketStats(createCompleteStarterDesign(NOW)).costCredits).toBeLessThanOrEqual(
      BASE_BUDGET_CREDITS,
    );
  });

  it('spends RP, respects prerequisites and unlocks parts / budget', () => {
    const rich = { milestones: MILESTONES.map((m) => m.id), tech: [] };
    expect(canResearch(INITIAL_PROGRESSION, 'extended-tankage')).toMatchObject({ ok: false });
    expect(canResearch(rich, 'vacuum-propulsion')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Requires Engine Block 2/),
    });
    const a = purchaseTech(rich, 'engine-block-2');
    if (!a.ok) throw new Error(a.reason);
    expect(unlockedPartIds(a.progression).has('engine-sl-b2')).toBe(true);
    expect(researchAvailable(a.progression)).toBe(researchAvailable(rich) - 3);
    expect(purchaseTech(a.progression, 'engine-block-2').ok).toBe(false);
    const b = purchaseTech(a.progression, 'program-expansion');
    if (!b.ok) throw new Error(b.reason);
    expect(budgetCredits(b.progression)).toBeGreaterThan(budgetCredits(a.progression));
    expect(purchaseTech(rich, 'warp').ok).toBe(false);
  });
});

describe('milestones', () => {
  it('awards nothing for the starter and booster/full-stack milestones for the reference design', () => {
    expect(newlyAchieved([], { blueprints: [createStarterBlueprint(NOW)] })).toEqual([]);
    const ids = newlyAchieved([], { blueprints: [createCompleteStarterDesign(NOW)] }).map(
      (m) => m.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining(['booster-lit', 'booster-complete', 'full-stack', 'outfitted']),
    );
    expect(ids).not.toContain('first-certified');
  });

  it('does not re-award recorded milestones', () => {
    const bp = createCompleteStarterDesign(NOW);
    const all = MILESTONES.map((m) => m.id);
    expect(newlyAchieved(all, { blueprints: [bp] })).toEqual([]);
  });

  it('awards certification milestones only without override', () => {
    const full = createCompleteStarterDesign(NOW);
    const ctx = { unlockedPartIds: new Set<string>(), budgetCredits: 1e9 };
    const ok = certify(full, evaluateReadiness(full, ctx), false, NOW);
    if (!ok.ok) throw new Error();
    const ids = newlyAchieved([], { blueprints: [ok.blueprint] }).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['first-certified', 'crew-rated']));
    const starter = createStarterBlueprint(NOW);
    const forced = certify(starter, evaluateReadiness(starter, ctx), true, NOW);
    if (!forced.ok) throw new Error();
    expect(newlyAchieved([], { blueprints: [forced.blueprint] }).map((m) => m.id)).not.toContain(
      'first-certified',
    );
  });

  it('design bureau needs two substantial designs', () => {
    const a = createCompleteStarterDesign(NOW, 'A', 'a');
    const b = createCompleteStarterDesign(NOW, 'B', 'b');
    expect(newlyAchieved([], { blueprints: [a] }).map((m) => m.id)).not.toContain('design-bureau');
    expect(newlyAchieved([], { blueprints: [a, b] }).map((m) => m.id)).toContain('design-bureau');
  });

  it('total RP from milestones cannot buy the whole tree (meaningful choice)', () => {
    const total = MILESTONES.reduce((s, m) => s + m.rewardRp, 0);
    const tree = TECH_TREE.reduce((s, t) => s + t.costRp, 0);
    expect(total).toBeLessThan(tree);
    expect(total).toBeGreaterThanOrEqual(6);
  });
});
