import { describe, expect, it } from 'vitest';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { migrateSave } from '../src/persistence/migrations';
import {
  CORRUPT_BACKUP_KEY,
  createMemoryStorage,
  DEFAULT_UI,
  loadGame,
  parseSave,
  SAVE_KEY,
  serializeSave,
  writeSave,
  type SaveData,
} from '../src/persistence/saveGame';

const NOW = '2026-01-01T00:00:00.000Z';

function sampleData(): Omit<SaveData, 'saveVersion'> {
  const a = createCompleteStarterDesign(NOW, 'Alpha', 'bp-a');
  const b = createStarterBlueprint(NOW, 'Beta', 'bp-b');
  return {
    savedAt: NOW,
    activeBlueprintId: 'bp-b',
    blueprints: [a, { ...b, finish: 'weathered', role: 'cargo' }],
    progression: {
      milestones: ['booster-lit', 'full-stack'],
      tech: ['program-expansion'],
      completedMissions: ['test-flight'],
    },
    mission: {
      missionId: 'orbital-flight',
      designId: 'bp-a',
      crewIds: ['okafor', 'lindqvist'],
      payloadId: 'science-pod',
      conditionsSeed: 42,
      waits: 1,
      commit: { designId: 'bp-a', revision: 3, at: NOW },
    },
    ui: { guideCollapsed: true, assemblyMode: 'structure' },
  };
}

describe('save/load v2', () => {
  it('round-trips designs, progression and UI prefs', () => {
    const storage = createMemoryStorage();
    const data = sampleData();
    expect(writeSave(storage, data)).toEqual({ ok: true });
    const loaded = loadGame(storage);
    expect(loaded.status).toBe('loaded');
    if (loaded.status !== 'loaded') return;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.data.blueprints).toEqual(data.blueprints);
    expect(loaded.data.activeBlueprintId).toBe('bp-b');
    expect(loaded.data.progression).toEqual(data.progression);
    expect(loaded.data.mission).toEqual(data.mission);
    expect(loaded.data.ui).toEqual(data.ui);
  });

  it('reports empty storage', () => {
    expect(loadGame(createMemoryStorage())).toEqual({ status: 'empty' });
  });

  it('rejects unreadable saves and backs up the raw data', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(loadGame(storage).status).toBe('corrupt');
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe('{not json');
  });

  it('rejects saves with no usable designs, bad versions or future versions', () => {
    const good = JSON.parse(serializeSave(sampleData()));
    const bad: unknown[] = [
      null,
      [],
      { ...good, saveVersion: undefined },
      { ...good, blueprints: 'nope' },
      { ...good, blueprints: [] },
      { ...good, blueprints: [{ id: 1 }] },
    ];
    for (const v of bad) expect(parseSave(JSON.stringify(v)).status).toBe('corrupt');
    const future = parseSave(JSON.stringify({ ...good, saveVersion: 99 }));
    expect(future.status === 'corrupt' && future.reason).toMatch(/newer version/);
  });

  it('skips damaged designs but keeps the rest (partial recovery)', () => {
    const good = JSON.parse(serializeSave(sampleData()));
    const damaged = {
      ...good.blueprints[0],
      parts: [{ ...good.blueprints[0].parts[0], partId: 'ghost' }],
    };
    const result = parseSave(
      JSON.stringify({
        ...good,
        activeBlueprintId: 'bp-a',
        blueprints: [damaged, good.blueprints[1], good.blueprints[1]],
      }),
    );
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;
    expect(result.data.blueprints.map((b) => b.id)).toEqual(['bp-b']);
    expect(result.data.activeBlueprintId).toBe('bp-b');
    expect(result.warnings.join(' ')).toMatch(/damaged and skipped/);
    expect(result.warnings.join(' ')).toMatch(/Duplicate/);
  });

  it('backs up the original when a save loads with damage', () => {
    const storage = createMemoryStorage();
    const good = JSON.parse(serializeSave(sampleData()));
    const raw = JSON.stringify({ ...good, blueprints: [{ broken: true }, good.blueprints[1]] });
    storage.setItem(SAVE_KEY, raw);
    expect(loadGame(storage).status).toBe('loaded');
    expect(storage.getItem(CORRUPT_BACKUP_KEY)).toBe(raw);
  });

  it('sanitizes progression, cosmetic fields and certification', () => {
    const good = JSON.parse(serializeSave(sampleData()));
    good.progression = {
      milestones: ['full-stack', 'made-up', 'full-stack', 3],
      tech: ['vacuum-propulsion', 'nope'],
      completedMissions: ['test-flight', 'mars'],
    };
    good.blueprints[1] = {
      ...good.blueprints[1],
      finish: 'gold',
      role: 'tourist',
      certification: { revision: 'x' },
    };
    good.ui = { guideCollapsed: 'yes', assemblyMode: 'vr' };
    const result = parseSave(JSON.stringify(good));
    if (result.status !== 'loaded') throw new Error('expected loaded');
    expect(result.data.progression).toEqual({
      milestones: ['full-stack'],
      tech: [], // vacuum needs block 2
      completedMissions: ['test-flight'],
    });
    const b = result.data.blueprints[1]!;
    expect([b.finish, b.role, b.certification]).toEqual(['brushed', 'crew', null]);
    expect(result.data.ui).toEqual(DEFAULT_UI);
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
    expect(writeSave(broken, sampleData())).toEqual({ ok: false, reason: 'quota' });
  });
});

describe('migration v1 → v2', () => {
  const v1Blueprint = () => {
    const { revision, finish, role, certification, ...rest } = createCompleteStarterDesign(NOW);
    void revision;
    void finish;
    void role;
    void certification;
    return { ...rest, schemaVersion: 1 };
  };

  it('wraps the single v1 blueprint into a library with defaults', () => {
    const v1 = { saveVersion: 1, savedAt: NOW, blueprint: v1Blueprint(), guideCollapsed: true };
    const result = parseSave(JSON.stringify(v1));
    expect(result.status).toBe('loaded');
    if (result.status !== 'loaded') return;
    expect(result.warnings).toEqual(['Save upgraded from version 1.']);
    expect(result.data.blueprints).toHaveLength(1);
    const bp = result.data.blueprints[0]!;
    expect(bp.schemaVersion).toBe(2);
    expect([bp.finish, bp.role, bp.certification, bp.revision]).toEqual([
      'brushed',
      'crew',
      null,
      1,
    ]);
    expect(bp.parts).toHaveLength(createCompleteStarterDesign(NOW).parts.length);
    expect(result.data.activeBlueprintId).toBe(bp.id);
    expect(result.data.progression).toEqual({ milestones: [], tech: [], completedMissions: [] });
    expect(result.data.mission).toBeNull();
    expect(result.data.ui).toEqual({ guideCollapsed: true, assemblyMode: 'catalog' });
  });

  it('treats a migrated v1 save with a broken blueprint as corrupt', () => {
    expect(parseSave(JSON.stringify({ saveVersion: 1, blueprint: { broken: true } })).status).toBe(
      'corrupt',
    );
  });

  it('passes current-version data through and rejects invalid versions', () => {
    expect(migrateSave({ saveVersion: 3, x: 1 })).toEqual({
      ok: true,
      data: { saveVersion: 3, x: 1 },
    });
    expect(migrateSave({ saveVersion: 0 }).ok).toBe(false);
    expect(migrateSave({ saveVersion: 1.5 }).ok).toBe(false);
  });
});

describe('migration v2 → v3', () => {
  it('adds completed missions and an empty mission plan', () => {
    const v3 = JSON.parse(serializeSave(sampleData()));
    const { mission, ...rest } = v3;
    void mission;
    const v2 = {
      ...rest,
      saveVersion: 2,
      progression: { milestones: ['full-stack'], tech: ['program-expansion'] },
    };
    const result = parseSave(JSON.stringify(v2));
    if (result.status !== 'loaded') throw new Error('expected loaded');
    expect(result.warnings).toEqual(['Save upgraded from version 2.']);
    expect(result.data.progression.completedMissions).toEqual([]);
    expect(result.data.progression.tech).toEqual(['program-expansion']);
    expect(result.data.mission).toBeNull();
    expect(result.data.blueprints).toHaveLength(2);
  });

  it('drops an unreadable mission plan and unknown crew / designs', () => {
    const good = JSON.parse(serializeSave(sampleData()));
    const bad = parseSave(JSON.stringify({ ...good, mission: { missionId: 'mars' } }));
    if (bad.status !== 'loaded') throw new Error();
    expect(bad.data.mission).toBeNull();
    expect(bad.warnings.join(' ')).toMatch(/mission plan/);
    const partial = parseSave(
      JSON.stringify({
        ...good,
        mission: { ...good.mission, crewIds: ['okafor', 'ghost'], designId: 'gone' },
      }),
    );
    if (partial.status !== 'loaded') throw new Error();
    expect(partial.data.mission?.crewIds).toEqual(['okafor']);
    expect(partial.data.mission?.designId).toBeNull();
  });
});
