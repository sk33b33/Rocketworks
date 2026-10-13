/** Save-format migrations. Each entry upgrades version N to N+1; never edit a shipped migration. */

export const CURRENT_SAVE_VERSION = 5;

type Data = Record<string, unknown>;
type Migration = (data: Data) => Data;

const isRecord = (v: unknown): v is Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** v1 blueprint → v2: adds revision, finish, role and certification with neutral defaults. */
function upgradeBlueprintV1(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  return {
    ...raw,
    schemaVersion: 2,
    revision: 1,
    finish: 'brushed',
    role: 'crew',
    certification: null,
  };
}

/** Index N migrates saveVersion N to N+1. */
const MIGRATIONS: Record<number, Migration> = {
  // v1 (Stage 1): a single blueprint. v2 (Stage 2): a design library plus program progression.
  1: (data) => {
    const blueprint = upgradeBlueprintV1(data.blueprint);
    const id = isRecord(blueprint) && typeof blueprint.id === 'string' ? blueprint.id : undefined;
    return {
      saveVersion: 2,
      savedAt: data.savedAt,
      activeBlueprintId: id,
      blueprints: blueprint === undefined ? [] : [blueprint],
      progression: { milestones: [], tech: [] },
      ui: { guideCollapsed: data.guideCollapsed === true, assemblyMode: 'catalog' },
    };
  },
  // v3 (Stage 3): mission plan and completed missions.
  2: (data) => ({
    ...data,
    progression: isRecord(data.progression)
      ? { ...data.progression, completedMissions: [] }
      : data.progression,
    mission: null,
  }),
  // v4 (Stage 4): flight history.
  3: (data) => ({ ...data, flights: [] }),
  // v5 (Stage 6): recovered-hardware fleet; mission plans gain recovery and fleet choices.
  4: (data) => ({
    ...data,
    fleet: [],
    mission: isRecord(data.mission)
      ? { ...data.mission, recovery: null, boosterFleetId: null, shipFleetId: null }
      : data.mission,
  }),
};

export type MigrationResult =
  { ok: true; data: Data; migratedFrom?: number } | { ok: false; reason: string };

export function migrateSave(raw: unknown): MigrationResult {
  if (!isRecord(raw)) return { ok: false, reason: 'Save is not an object.' };
  let data = raw;
  let version = data.saveVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'Save has no valid version number.' };
  }
  if (version > CURRENT_SAVE_VERSION) {
    return { ok: false, reason: `Save was made by a newer version of the game (v${version}).` };
  }
  const original = version;
  while (version < CURRENT_SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, reason: `No migration from save version ${version}.` };
    data = step(data);
    version += 1;
    data = { ...data, saveVersion: version };
  }
  return original === CURRENT_SAVE_VERSION
    ? { ok: true, data }
    : { ok: true, data, migratedFrom: original };
}
