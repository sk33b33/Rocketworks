import type { RuntimeSnapshot } from '../flight/flightRuntime';
import type { KeyValueStorage } from './saveGame';

/*
 * In-progress flight autosave, kept apart from the main save: it changes often, can be large,
 * and a damaged snapshot must never stop the rest of the program from loading. Versioned on its
 * own. A launch still climbing from the pad is not resumable; only a marker is kept so the
 * player can be told what happened after a reload.
 */

export const FLIGHT_SAVE_KEY = 'rocketworks.flight';
export const FLIGHT_SNAPSHOT_VERSION = 1;

export type FlightSaveRecord =
  | {
      readonly version: typeof FLIGHT_SNAPSHOT_VERSION;
      readonly kind: 'flight';
      readonly savedAt: string;
      readonly missionId: string;
      readonly outcomeId: string;
      readonly runtime: RuntimeSnapshot;
    }
  | {
      readonly version: typeof FLIGHT_SNAPSHOT_VERSION;
      readonly kind: 'ascent';
      readonly savedAt: string;
      readonly missionId: string;
      readonly missionName: string;
    };

export type FlightLoadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly record: FlightSaveRecord }
  | { readonly status: 'corrupt'; readonly reason: string };

// JSON has no Infinity/NaN: encode them so planning timers (±Infinity) survive the round trip.
const INF = '__+inf';
const NINF = '__-inf';
const NAN = '__nan';

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? NAN : v > 0 ? INF : NINF) : v,
  );
}

export function decodeJson(json: string): unknown {
  return JSON.parse(json, (_k, v: unknown) =>
    v === INF ? Infinity : v === NINF ? -Infinity : v === NAN ? NaN : v,
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);

/** Structural check of a runtime snapshot; returns a reason when it can't be trusted. */
export function checkRuntimeSnapshot(raw: unknown): string | null {
  if (!isRecord(raw)) return 'snapshot is not an object';
  if (raw.v !== 1) return 'unknown snapshot format';
  if (
    raw.phase !== 'flight' &&
    raw.phase !== 'proximity' &&
    raw.phase !== 'surface' &&
    raw.phase !== 'voyage'
  )
    return 'unknown flight phase';
  const ctx = raw.context;
  if (
    !isRecord(ctx) ||
    !isRecord(ctx.outcome) ||
    typeof ctx.outcome.missionId !== 'string' ||
    !isRecord(ctx.blueprint) ||
    !Array.isArray(ctx.blueprint.parts) ||
    !isRecord(ctx.spec) ||
    !isRecord(ctx.spec.stage)
  )
    return 'flight context is incomplete';
  const live = raw.live;
  if (!isRecord(live) || !isVec(live.r) || !isVec(live.v) || !isNum(live.tS) || !isNum(live.propKg))
    return 'ship state is damaged';
  if (!isRecord(raw.progress) || !isRecord(raw.ps)) return 'mission progress is damaged';
  if (raw.phase === 'proximity' && !isRecord(raw.prox)) return 'station state is missing';
  if (live.origin !== undefined && live.origin !== 'sun' && live.origin !== 'mars')
    return 'ship state is damaged';
  if ((raw.phase === 'voyage' || live.origin) && !isRecord(raw.mars))
    return 'Mars mission state is missing';
  const surface =
    (isRecord(raw.lunar) && isRecord(raw.lunar.surface)) ||
    (isRecord(raw.mars) && isRecord(raw.mars.surface));
  if (raw.phase === 'surface' && !surface) return 'surface state is missing';
  return null;
}

export function readFlightSave(storage: KeyValueStorage): FlightLoadResult {
  let json: string | null;
  try {
    json = storage.getItem(FLIGHT_SAVE_KEY);
  } catch {
    return { status: 'none' };
  }
  if (json === null) return { status: 'none' };
  let raw: unknown;
  try {
    raw = decodeJson(json);
  } catch {
    return { status: 'corrupt', reason: 'the saved flight is not valid JSON' };
  }
  if (!isRecord(raw) || raw.version !== FLIGHT_SNAPSHOT_VERSION)
    return { status: 'corrupt', reason: 'the saved flight was made by another version' };
  if (typeof raw.missionId !== 'string' || typeof raw.savedAt !== 'string')
    return { status: 'corrupt', reason: 'the saved flight has no mission' };
  if (raw.kind === 'ascent') {
    return typeof raw.missionName === 'string'
      ? { status: 'ok', record: raw as unknown as FlightSaveRecord }
      : { status: 'corrupt', reason: 'the launch marker is damaged' };
  }
  if (raw.kind !== 'flight' || typeof raw.outcomeId !== 'string')
    return { status: 'corrupt', reason: 'unknown saved flight' };
  const problem = checkRuntimeSnapshot(raw.runtime);
  return problem
    ? { status: 'corrupt', reason: problem }
    : { status: 'ok', record: raw as unknown as FlightSaveRecord };
}

export function writeFlightSave(
  storage: KeyValueStorage,
  record: FlightSaveRecord,
): { ok: true } | { ok: false; reason: string } {
  try {
    storage.setItem(FLIGHT_SAVE_KEY, encodeJson(record));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'storage error' };
  }
}

export function clearFlightSave(storage: KeyValueStorage): void {
  try {
    storage.removeItem(FLIGHT_SAVE_KEY);
  } catch {
    /* best effort */
  }
}
