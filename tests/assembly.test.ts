import { describe, expect, it } from 'vitest';
import { canAttach, compatibleTargets, listTargets } from '../src/rocket/assembly/compatibility';
import {
  attachPart,
  fillCompatible,
  removePart,
  replacePart,
  rotatePart,
} from '../src/rocket/assembly/operations';
import { validateBlueprint } from '../src/rocket/assembly/validation';
import {
  createCompleteStarterDesign,
  createEmptyBlueprint,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
}

function add(bp: RocketBlueprint, partId: string, parentId: string | null, socketId: string) {
  return must(attachPart(bp, partId, { parentId, socketId }, NOW));
}

describe('compatibility', () => {
  const base = createStarterBlueprint(NOW); // p1 = booster engine section

  it('accepts an engine on an engine mount', () => {
    expect(canAttach(base, 'engine-sl', { parentId: 'p1', socketId: 'engine-inner-1' })).toEqual({
      ok: true,
    });
  });

  it('rejects a mismatched socket type with an explanation', () => {
    const r = canAttach(base, 'grid-fin', { parentId: 'p1', socketId: 'engine-inner-1' });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.reason).toMatch(
        /Grid Fin attaches to a grid-fin actuator, but this is an engine mount/,
      );
  });

  it('rejects occupied sockets', () => {
    const { blueprint } = add(base, 'engine-sl', 'p1', 'engine-inner-1');
    const r = canAttach(blueprint, 'engine-sl', { parentId: 'p1', socketId: 'engine-inner-1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already occupied/);
  });

  it('rejects locked parts, unknown parts and unknown sockets', () => {
    const locked = canAttach(base, 'engine-vac', { parentId: 'p1', socketId: 'engine-inner-1' });
    expect(locked.ok === false && locked.reason).toMatch(/locked/);
    expect(
      canAttach(
        base,
        'engine-vac',
        { parentId: 'p1', socketId: 'engine-inner-1' },
        new Set(['engine-vac']),
      ).ok,
    ).toBe(true);
    expect(canAttach(base, 'warp-drive', { parentId: 'p1', socketId: 'top' }).ok).toBe(false);
    expect(canAttach(base, 'booster-tank', { parentId: 'p1', socketId: 'nope' }).ok).toBe(false);
    expect(canAttach(base, 'booster-tank', { parentId: 'p99', socketId: 'top' }).ok).toBe(false);
  });

  it('only root parts go on the stand, and only when it is free', () => {
    const empty = createEmptyBlueprint(NOW);
    expect(canAttach(empty, 'booster-tank', { parentId: null, socketId: 'stand' }).ok).toBe(false);
    expect(
      canAttach(empty, 'booster-engine-section', { parentId: null, socketId: 'stand' }).ok,
    ).toBe(true);
    expect(
      canAttach(base, 'booster-engine-section', { parentId: null, socketId: 'stand' }).ok,
    ).toBe(false);
  });

  it('prevents ship parts on the booster stack', () => {
    expect(canAttach(base, 'nose-cone', { parentId: 'p1', socketId: 'top' }).ok).toBe(false);
    expect(canAttach(base, 'ship-tank', { parentId: 'p1', socketId: 'top' }).ok).toBe(false);
  });

  it('lists free targets with compatibility flags', () => {
    const targets = listTargets(base, 'engine-sl');
    expect(targets.filter((t) => t.check.ok)).toHaveLength(13);
    expect(targets.some((t) => !t.check.ok)).toBe(true);
    expect(compatibleTargets(base, 'booster-tank')).toHaveLength(1);
  });
});

describe('operations', () => {
  it('attach assigns sequential ids and updates timestamps immutably', () => {
    const base = createStarterBlueprint(NOW);
    const r = must(attachPart(base, 'booster-tank', { parentId: 'p1', socketId: 'top' }, LATER));
    expect(r.instanceId).toBe('p2');
    expect(r.blueprint.nextInstanceNumber).toBe(3);
    expect(r.blueprint.updatedAt).toBe(LATER);
    expect(base.parts).toHaveLength(1);
  });

  it('remove takes the whole subtree and keeps the rest valid', () => {
    let bp = createStarterBlueprint(NOW);
    bp = add(bp, 'booster-tank', 'p1', 'top').blueprint; // p2
    bp = add(bp, 'booster-tank', 'p2', 'top').blueprint; // p3
    bp = add(bp, 'antenna', 'p3', 'detail-1').blueprint; // p4
    bp = add(bp, 'engine-sl', 'p1', 'engine-inner-1').blueprint; // p5
    const r = must(removePart(bp, 'p2', LATER));
    expect(r.removedCount).toBe(3);
    expect(r.blueprint.parts.map((p) => p.id)).toEqual(['p1', 'p5']);
    expect(validateBlueprint(r.blueprint).valid).toBe(true);
    // Removed sockets can be reused.
    expect(canAttach(r.blueprint, 'booster-tank', { parentId: 'p1', socketId: 'top' }).ok).toBe(
      true,
    );
    expect(removePart(bp, 'p404', LATER).ok).toBe(false);
  });

  it('replace keeps children on matching sockets and drops the rest', () => {
    let bp = createStarterBlueprint(NOW);
    bp = add(bp, 'booster-tank', 'p1', 'top').blueprint; // p2
    bp = add(bp, 'booster-forward-section', 'p2', 'top').blueprint; // p3
    bp = add(bp, 'hot-stage-interstage', 'p3', 'top').blueprint; // p4
    bp = add(bp, 'ship-aft-section', 'p4', 'top').blueprint; // p5
    bp = add(bp, 'ship-tank', 'p5', 'top').blueprint; // p6
    bp = add(bp, 'heat-shield', 'p6', 'heat-shield').blueprint; // p7
    bp = add(bp, 'crew-cabin', 'p6', 'top').blueprint; // p8
    bp = add(bp, 'antenna', 'p6', 'detail-2').blueprint; // p9

    // Cabin -> cargo bay: same top + heat-shield sockets.
    const swap = must(
      replacePart(bp, 'p6', 'ship-tank-extended', LATER, new Set(['ship-tank-extended'])),
    );
    expect(swap.droppedCount).toBe(0);
    expect(swap.blueprint.parts.find((p) => p.id === 'p6')?.partId).toBe('ship-tank-extended');

    // Booster tank -> forward section: the forward section's top ring is a different type.
    const r = must(replacePart(bp, 'p2', 'booster-forward-section', LATER));
    expect(r.droppedCount).toBe(7);
    expect(validateBlueprint(r.blueprint).valid).toBe(true);

    expect(replacePart(bp, 'p6', 'nose-cone', LATER).ok).toBe(true);
    expect(replacePart(bp, 'p6', 'booster-tank', LATER).ok).toBe(false);
    expect(replacePart(bp, 'p6', 'ship-tank-extended', LATER).ok).toBe(false); // locked
  });

  it('rotates by the part step and refuses fixed parts', () => {
    let bp = createStarterBlueprint(NOW);
    bp = add(bp, 'booster-tank', 'p1', 'top').blueprint;
    let rotation = 0;
    for (let i = 0; i < 8; i++) {
      const r = must(rotatePart(bp, 'p2', LATER));
      bp = r.blueprint;
      rotation = r.rotationDeg;
    }
    expect(rotation).toBe(0);
    expect(must(rotatePart(bp, 'p2', LATER)).rotationDeg).toBe(45);
    expect(rotatePart(bp, 'p1', LATER).ok).toBe(false);
  });

  it('fill attaches to every free compatible socket once', () => {
    const r = must(fillCompatible(createStarterBlueprint(NOW), 'engine-sl', LATER));
    expect(r.attachedCount).toBe(13);
    expect(validateBlueprint(r.blueprint).valid).toBe(true);
    expect(fillCompatible(r.blueprint, 'engine-sl', LATER).ok).toBe(false);
  });
});

describe('validateBlueprint', () => {
  it('accepts the starter and complete designs', () => {
    expect(validateBlueprint(createStarterBlueprint(NOW))).toEqual({ valid: true, issues: [] });
    expect(validateBlueprint(createCompleteStarterDesign(NOW)).issues).toEqual([]);
  });

  it('detects structural corruption', () => {
    const bp = createStarterBlueprint(NOW);
    const p1 = bp.parts[0]!;
    const cases: RocketBlueprint[] = [
      { ...bp, parts: [p1, { ...p1 }] },
      {
        ...bp,
        parts: [
          p1,
          { id: 'p2', partId: 'nope', parent: { parentId: 'p1', socketId: 'top' }, rotationDeg: 0 },
        ],
      },
      {
        ...bp,
        parts: [
          p1,
          {
            id: 'p2',
            partId: 'booster-tank',
            parent: { parentId: 'p9', socketId: 'top' },
            rotationDeg: 0,
          },
        ],
      },
      {
        ...bp,
        parts: [
          p1,
          {
            id: 'p2',
            partId: 'grid-fin',
            parent: { parentId: 'p1', socketId: 'top' },
            rotationDeg: 0,
          },
        ],
      },
      {
        ...bp,
        parts: [
          p1,
          {
            id: 'p2',
            partId: 'booster-tank',
            parent: { parentId: 'p1', socketId: 'nope' },
            rotationDeg: 0,
          },
        ],
      },
      { ...bp, parts: [{ ...p1, rotationDeg: 10 }] },
      { ...bp, parts: [{ ...p1, partId: 'booster-tank' }] },
      { ...bp, nextInstanceNumber: 1 },
      {
        ...bp,
        nextInstanceNumber: 4,
        parts: [
          p1,
          {
            id: 'p2',
            partId: 'engine-sl',
            parent: { parentId: 'p1', socketId: 'engine-inner-1' },
            rotationDeg: 0,
          },
          {
            id: 'p3',
            partId: 'engine-sl',
            parent: { parentId: 'p1', socketId: 'engine-inner-1' },
            rotationDeg: 0,
          },
        ],
      },
    ];
    for (const c of cases) expect(validateBlueprint(c).valid).toBe(false);
  });
});
