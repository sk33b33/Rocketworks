import { validateBlueprint } from '../rocket/assembly/validation';
import {
  BLUEPRINT_SCHEMA_VERSION,
  type PartInstance,
  type RocketBlueprint,
} from '../rocket/model/types';
import { CURRENT_SAVE_VERSION, migrateSave } from './migrations';

/** Versioned save data. Independent of Three.js and React. */
export interface SaveData {
  readonly saveVersion: typeof CURRENT_SAVE_VERSION;
  readonly savedAt: string;
  readonly blueprint: RocketBlueprint;
  readonly guideCollapsed: boolean;
}

export const SAVE_KEY = 'rocketworks.save';
export const CORRUPT_BACKUP_KEY = 'rocketworks.save.corrupt';

/** Minimal Storage subset so tests and private-mode fallbacks can supply their own. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; data: SaveData }
  | { status: 'corrupt'; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function parseInstance(raw: unknown): PartInstance | null {
  if (!isRecord(raw) || !isString(raw.id) || !isString(raw.partId) || !isRecord(raw.parent))
    return null;
  const { parentId, socketId } = raw.parent;
  if (!(parentId === null || isString(parentId)) || !isString(socketId)) return null;
  const rotationDeg = raw.rotationDeg ?? 0;
  if (typeof rotationDeg !== 'number' || !Number.isFinite(rotationDeg)) return null;
  return { id: raw.id, partId: raw.partId, parent: { parentId, socketId }, rotationDeg };
}

/** Runtime shape + integrity check for untrusted blueprint data. */
export function parseBlueprint(
  raw: unknown,
): { ok: true; blueprint: RocketBlueprint } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: 'Blueprint is not an object.' };
  if (raw.schemaVersion !== BLUEPRINT_SCHEMA_VERSION)
    return { ok: false, reason: 'Unsupported blueprint schema.' };
  if (
    !isString(raw.id) ||
    !isString(raw.name) ||
    !isString(raw.createdAt) ||
    !isString(raw.updatedAt)
  ) {
    return { ok: false, reason: 'Blueprint is missing its id, name or timestamps.' };
  }
  if (
    typeof raw.nextInstanceNumber !== 'number' ||
    !Number.isInteger(raw.nextInstanceNumber) ||
    !Array.isArray(raw.parts)
  ) {
    return { ok: false, reason: 'Blueprint part list is malformed.' };
  }
  const parts: PartInstance[] = [];
  for (const item of raw.parts) {
    const inst = parseInstance(item);
    if (!inst) return { ok: false, reason: 'Blueprint contains a malformed part entry.' };
    parts.push(inst);
  }
  const blueprint: RocketBlueprint = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    nextInstanceNumber: raw.nextInstanceNumber,
    parts,
  };
  const validation = validateBlueprint(blueprint);
  if (!validation.valid)
    return { ok: false, reason: validation.issues[0] ?? 'Blueprint failed validation.' };
  return { ok: true, blueprint };
}

export function parseSave(json: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { status: 'corrupt', reason: 'Save file is not valid JSON.' };
  }
  const migrated = migrateSave(raw);
  if (!migrated.ok) return { status: 'corrupt', reason: migrated.reason };
  const bp = parseBlueprint(migrated.data.blueprint);
  if (!bp.ok) return { status: 'corrupt', reason: bp.reason };
  const savedAt = isString(migrated.data.savedAt) ? migrated.data.savedAt : bp.blueprint.updatedAt;
  return {
    status: 'loaded',
    data: {
      saveVersion: CURRENT_SAVE_VERSION,
      savedAt,
      blueprint: bp.blueprint,
      guideCollapsed: migrated.data.guideCollapsed === true,
    },
  };
}

/** Reads the save; never throws. A corrupt save is backed up so it is not silently lost. */
export function loadGame(storage: KeyValueStorage): LoadResult {
  let json: string | null;
  try {
    json = storage.getItem(SAVE_KEY);
  } catch {
    return { status: 'corrupt', reason: 'Browser storage is unavailable.' };
  }
  if (json === null) return { status: 'empty' };
  const result = parseSave(json);
  if (result.status === 'corrupt') {
    try {
      storage.setItem(CORRUPT_BACKUP_KEY, json);
    } catch {
      /* best effort */
    }
  }
  return result;
}

export function serializeSave(
  blueprint: RocketBlueprint,
  guideCollapsed: boolean,
  savedAt: string,
): string {
  const data: SaveData = { saveVersion: CURRENT_SAVE_VERSION, savedAt, blueprint, guideCollapsed };
  return JSON.stringify(data);
}

export function writeSave(
  storage: KeyValueStorage,
  blueprint: RocketBlueprint,
  guideCollapsed: boolean,
  savedAt: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    storage.setItem(SAVE_KEY, serializeSave(blueprint, guideCollapsed, savedAt));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Storage write failed.' };
  }
}

/** In-memory storage used when localStorage is unavailable (and in tests). */
export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

export function getBrowserStorage(): { storage: KeyValueStorage; persistent: boolean } {
  try {
    const ls = globalThis.localStorage;
    const probe = '__rocketworks_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch {
    return { storage: createMemoryStorage(), persistent: false };
  }
}
