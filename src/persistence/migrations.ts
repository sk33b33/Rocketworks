/** Save-format migrations. Each entry upgrades version N to N+1; never edit a shipped migration. */

export const CURRENT_SAVE_VERSION = 1;

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Index N migrates saveVersion N to N+1. Empty while only version 1 exists. */
const MIGRATIONS: Record<number, Migration> = {};

export type MigrationResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };

export function migrateSave(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'Save is not an object.' };
  let data = raw as Record<string, unknown>;
  let version = data.saveVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'Save has no valid version number.' };
  }
  if (version > CURRENT_SAVE_VERSION) {
    return { ok: false, reason: `Save was made by a newer version of the game (v${version}).` };
  }
  while (version < CURRENT_SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, reason: `No migration from save version ${version}.` };
    data = step(data);
    version += 1;
    data = { ...data, saveVersion: version };
  }
  return { ok: true, data };
}
