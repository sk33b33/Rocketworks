import { describe, expect, it } from 'vitest';
import {
  addNewBlueprint,
  deleteBlueprint,
  duplicateBlueprint,
  MAX_BLUEPRINTS,
  normalizeName,
  renameBlueprint,
  setFinish,
  uniqueName,
} from '../src/rocket/library/blueprintLibrary';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';

const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

describe('blueprint library', () => {
  const base = (): RocketBlueprint[] => [createCompleteStarterDesign(NOW, 'Alpha', 'a')];

  it('normalizes and validates names', () => {
    expect(normalizeName('  Big   Rocket ')).toEqual({ ok: true, name: 'Big Rocket' });
    expect(normalizeName('   ').ok).toBe(false);
    expect(normalizeName('x'.repeat(41)).ok).toBe(false);
    expect(uniqueName('Alpha', ['alpha', 'Alpha (2)'])).toBe('Alpha (3)');
  });

  it('adds, duplicates (uncertified, next to source) and enforces the limit', () => {
    const certified = {
      ...base()[0]!,
      certification: { revision: 0, role: 'crew' as const, override: false, at: NOW },
    };
    const r = duplicateBlueprint([certified], 'a', 'b', LATER);
    if (!r.ok) throw new Error(r.reason);
    expect(r.list.map((b) => b.id)).toEqual(['a', 'b']);
    expect(r.blueprint.name).toBe('Alpha copy');
    expect(r.blueprint.certification).toBeNull();
    expect(r.blueprint.parts).toEqual(certified.parts);
    const n = addNewBlueprint(r.list, 'c', LATER);
    if (!n.ok) throw new Error(n.reason);
    expect(n.blueprint.parts).toHaveLength(1);
    expect(n.blueprint.name).toBe('New Design');
    const full = Array.from({ length: MAX_BLUEPRINTS }, (_, i) =>
      createStarterBlueprint(NOW, `D${i}`, `d${i}`),
    );
    expect(addNewBlueprint(full, 'x', NOW).ok).toBe(false);
    expect(duplicateBlueprint(full, 'd0', 'x', NOW).ok).toBe(false);
  });

  it('deletes and picks a sensible new active design', () => {
    const list = [
      createStarterBlueprint(NOW, 'A', 'a'),
      createStarterBlueprint(NOW, 'B', 'b'),
      createStarterBlueprint(NOW, 'C', 'c'),
    ];
    const r = deleteBlueprint(list, 'b', 'b');
    if (!r.ok) throw new Error();
    expect(r.list.map((b) => b.id)).toEqual(['a', 'c']);
    expect(r.activeId).toBe('c');
    const keep = deleteBlueprint(list, 'a', 'c');
    expect(keep.ok && keep.activeId).toBe('c');
    expect(deleteBlueprint([list[0]!], 'a', 'a').ok).toBe(false);
  });

  it('renames with uniqueness and keeps finishes cosmetic', () => {
    const list = [createStarterBlueprint(NOW, 'A', 'a'), createStarterBlueprint(NOW, 'B', 'b')];
    expect(renameBlueprint(list, 'a', 'b', LATER).ok).toBe(false);
    const r = renameBlueprint(list, 'a', ' Heavy ', LATER);
    expect(r.ok && r.blueprint.name).toBe('Heavy');
    const f = setFinish(list[0]!, 'polished', LATER);
    expect(f.finish).toBe('polished');
    expect(f.revision).toBe(list[0]!.revision);
  });
});
