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
      recovery: null,
      boosterFleetId: null,
      shipFleetId: null,
    },
    ui: { guideCollapsed: true, assemblyMode: 'structure', randomFailures: false },
    flights: [],
    fleet: [],
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
    expect(result.data.ui).toEqual({
      guideCollapsed: true,
      assemblyMode: 'catalog',
      randomFailures: true,
    });
    expect(result.data.flights).toEqual([]);
  });

  it('treats a migrated v1 save with a broken blueprint as corrupt', () => {
    expect(parseSave(JSON.stringify({ saveVersion: 1, blueprint: { broken: true } })).status).toBe(
      'corrupt',
    );
  });

  it('passes current-version data through and rejects invalid versions', () => {
    expect(migrateSave({ saveVersion: 5, x: 1 })).toEqual({
      ok: true,
      data: { saveVersion: 5, x: 1 },
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

describe('migration v3 → v4 and flight history', () => {
  const flight = {
    id: 'f1',
    at: NOW,
    missionId: 'test-flight',
    missionName: 'Uncrewed Test Flight',
    designId: 'bp-a',
    designName: 'Alpha',
    result: 'success',
    summary: 'ok',
    credited: true,
    crewSafe: null,
    maxAltitudeM: 145_000,
    maxSpeedMS: 5_600,
    maxQPa: 32_000,
    durationS: 345,
    events: ['T+0s Liftoff!'],
  };

  it('adds an empty flight history to v3 saves', () => {
    const v4 = JSON.parse(serializeSave(sampleData()));
    const { flights, ...rest } = v4;
    void flights;
    const result = parseSave(JSON.stringify({ ...rest, saveVersion: 3 }));
    if (result.status !== 'loaded') throw new Error();
    expect(result.warnings).toEqual(['Save upgraded from version 3.']);
    expect(result.data.flights).toEqual([]);
  });

  it('round-trips flight records and drops damaged ones', () => {
    const good = JSON.parse(serializeSave({ ...sampleData(), flights: [flight as never] }));
    const ok = parseSave(JSON.stringify(good));
    if (ok.status !== 'loaded') throw new Error();
    expect(ok.data.flights).toEqual([flight]);
    const bad = parseSave(
      JSON.stringify({ ...good, flights: [flight, { id: 'x' }, { ...flight, result: 'won' }] }),
    );
    if (bad.status !== 'loaded') throw new Error();
    expect(bad.data.flights).toHaveLength(1);
    expect(bad.warnings.join(' ')).toMatch(/2 damaged flight record/);
  });

  it('keeps a valid orbital landing summary and drops a malformed one', () => {
    const landing = {
      outcome: 'landed',
      zoneName: 'Pad',
      missM: 420,
      shipRecovered: true,
      orbits: 1,
      hull: 1,
      shield: 0.9,
      peakG: 3.5,
      peakHeatKWm2: 510,
      grade: 'B',
      manual: true,
    };
    const data = {
      ...sampleData(),
      flights: [
        { ...flight, landing },
        { ...flight, id: 'f2', landing: { outcome: 'teleported' } },
      ],
    };
    const result = parseSave(serializeSave(data as never));
    if (result.status !== 'loaded') throw new Error();
    expect(result.data.flights[0]?.landing).toEqual(landing);
    expect(result.data.flights[1]?.landing).toBeUndefined();
    expect(result.data.flights).toHaveLength(2);
  });
});

describe('migration v4 → v5 and the fleet', () => {
  const vehicle = {
    id: 'fv-1',
    kind: 'booster',
    name: 'B-1',
    designId: 'bp-a',
    designName: 'Alpha',
    signature: 'sig',
    flights: 2,
    wear: 0.2,
    lastGrade: 'A',
    recoveredAt: NOW,
    refurbPending: false,
  };

  it('adds an empty fleet and default recovery choices to v4 saves', () => {
    const v5 = JSON.parse(serializeSave(sampleData()));
    const { fleet, mission, ...rest } = v5;
    void fleet;
    const { recovery, boosterFleetId, shipFleetId, ...oldMission } = mission;
    void recovery;
    void boosterFleetId;
    void shipFleetId;
    const result = parseSave(JSON.stringify({ ...rest, mission: oldMission, saveVersion: 4 }));
    if (result.status !== 'loaded') throw new Error();
    expect(result.warnings).toEqual(['Save upgraded from version 4.']);
    expect(result.data.fleet).toEqual([]);
    expect(result.data.mission).toMatchObject({
      recovery: null,
      boosterFleetId: null,
      shipFleetId: null,
    });
  });

  it('round-trips fleet vehicles and recovery summaries, dropping damaged entries', () => {
    const recovery = {
      target: 'catch',
      outcome: 'caught',
      grade: 'S',
      manual: false,
      simulated: false,
      missM: 0.4,
      vertMS: 1.6,
      heatLoadMJm2: 1.2,
      summary: 'Caught.',
    };
    const flight = {
      id: 'f1',
      at: NOW,
      missionId: 'test-flight',
      missionName: 'Hop',
      designId: 'bp-a',
      designName: 'Alpha',
      result: 'success',
      summary: 'ok',
      credited: true,
      crewSafe: null,
      maxAltitudeM: 1,
      maxSpeedMS: 1,
      maxQPa: 1,
      durationS: 1,
      events: [],
      recovery,
      hardware: { boosterId: 'fv-1', shipId: null },
    };
    const data = {
      ...sampleData(),
      fleet: [vehicle, { ...vehicle, id: 'fv-1' }, { id: 'bad' }],
      flights: [flight],
      mission: { ...sampleData().mission!, recovery: 'platform', boosterFleetId: 'fv-1' },
    };
    const result = parseSave(serializeSave(data as never));
    if (result.status !== 'loaded') throw new Error();
    expect(result.data.fleet).toEqual([vehicle]);
    expect(result.warnings.join(' ')).toMatch(/2 damaged fleet record/);
    expect(result.data.flights[0]?.recovery).toEqual(recovery);
    expect(result.data.flights[0]?.hardware).toEqual({ boosterId: 'fv-1', shipId: null });
    expect(result.data.mission).toMatchObject({ recovery: 'platform', boosterFleetId: 'fv-1' });
  });
});
