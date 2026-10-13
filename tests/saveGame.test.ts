import { describe, expect, it } from 'vitest';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { migrateSave } from '../src/persistence/migrations';
import {
  CORRUPT_BACKUP_KEY,
  createMemoryStorage,
  loadGame,
  parseSave,
  SAVE_KEY,
  serializeSave,
  writeSave,
} from '../src/persistence/saveGame';

const NOW = '2026-01-01T00:00:00.000Z';

describe('save/load', () => {
  it('round-trips a complete build', () => {
    const storage = createMemoryStorage();
    const bp = createCompleteStarterDesign(NOW);
    expect(writeSave(storage, bp, true, NOW)).toEqual({ ok: true });
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.data.blueprint).toEqual(bp);
      expect(loaded.data.guideCollapsed).toBe(true);
    }
  });

  it('reports empty storage', () => {
    expect(loadGame(createMemoryStorage())).toEqual({ status: 'empty' });
  });

  it('rejects malformed saves and backs up the raw data', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const r = loadGame(storage);
    expect(r.status).toBe('corrupt');
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe('{not json');
  });

  it('rejects saves with structural or shape problems', () => {
    const good = JSON.parse(serializeSave(createStarterBlueprint(NOW), false, NOW));
    const variants: unknown[] = [
      null,
      [],
      { ...good, saveVersion: undefined },
      { ...good, saveVersion: 99 },
      { ...good, blueprint: { ...good.blueprint, parts: 'nope' } },
      { ...good, blueprint: { ...good.blueprint, parts: [{ id: 1 }] } },
      {
        ...good,
        blueprint: { ...good.blueprint, parts: [{ ...good.blueprint.parts[0], partId: 'ghost' }] },
      },
      { ...good, blueprint: { ...good.blueprint, schemaVersion: 7 } },
    ];
    for (const v of variants) expect(parseSave(JSON.stringify(v)).status).toBe('corrupt');
    const future = parseSave(JSON.stringify({ ...good, saveVersion: 99 }));
    expect(future.status === 'corrupt' && future.reason).toMatch(/newer version/);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(loadGame(broken).status).toBe('corrupt');
    expect(writeSave(broken, createStarterBlueprint(NOW), false, NOW)).toEqual({
      ok: false,
      reason: 'quota',
    });
  });

  it('migration passes current-version data through', () => {
    expect(migrateSave({ saveVersion: 1, x: 1 })).toEqual({
      ok: true,
      data: { saveVersion: 1, x: 1 },
    });
    expect(migrateSave({ saveVersion: 0 }).ok).toBe(false);
  });
});
