import { describe, expect, it } from 'vitest';
import { attachPart } from '../src/rocket/assembly/operations';
import {
  createCompleteStarterDesign,
  createEmptyBlueprint,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import {
  calculateRocketStats,
  STANDARD_GRAVITY_MS2,
} from '../src/rocket/stats/calculateRocketStats';

const NOW = '2026-01-01T00:00:00.000Z';

describe('calculateRocketStats', () => {
  it('is zero for an empty build', () => {
    const s = calculateRocketStats(createEmptyBlueprint(NOW));
    expect(s).toMatchObject({
      partCount: 0,
      dryMassKg: 0,
      propellantKg: 0,
      costCredits: 0,
      liftoffTwr: null,
    });
  });

  it('sums mass, propellant, thrust and cost exactly for a small build', () => {
    let bp = createStarterBlueprint(NOW);
    for (const [partId, socketId] of [
      ['booster-tank', 'top'],
      ['engine-sl', 'engine-inner-1'],
      ['engine-sl', 'engine-inner-2'],
    ] as const) {
      const r = attachPart(bp, partId, { parentId: 'p1', socketId }, NOW);
      if (!r.ok) throw new Error(r.reason);
      bp = r.blueprint;
    }
    const s = calculateRocketStats(bp);
    expect(s.partCount).toBe(4);
    expect(s.dryMassKg).toBe(60_000 + 22_000 + 2 * 1_600);
    expect(s.propellantKg).toBe(760_000);
    expect(s.wetMassKg).toBe(s.dryMassKg + s.propellantKg);
    expect(s.booster.thrustN).toBe(9_000_000);
    expect(s.booster.engineCount).toBe(2);
    expect(s.ship.thrustN).toBe(0);
    expect(s.costCredits).toBe(9_000 + 6_000 + 2 * 2_000);
    expect(s.liftoffTwr).toBeCloseTo(9_000_000 / (s.wetMassKg * STANDARD_GRAVITY_MS2), 10);
  });

  it('splits booster and ship and gives the starter design a liftoff TWR above 1', () => {
    const s = calculateRocketStats(createCompleteStarterDesign(NOW));
    expect(s.booster.engineCount).toBe(13);
    expect(s.ship.engineCount).toBe(6);
    expect(s.crewCapacity).toBe(8);
    expect(s.booster.dryMassKg + s.ship.dryMassKg).toBe(s.dryMassKg);
    expect(s.liftoffTwr).toBeGreaterThan(1.2);
    expect(s.liftoffTwr).toBeLessThan(2.5);
  });
});
