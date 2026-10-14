import { validateBlueprint } from '../rocket/assembly/validation';
import { isHullFinish, isVehicleRole } from '../rocket/model/finish';
import {
  BLUEPRINT_SCHEMA_VERSION,
  type Certification,
  type PartInstance,
  type RocketBlueprint,
} from '../rocket/model/types';
import { MAX_BLUEPRINTS } from '../rocket/library/blueprintLibrary';
import { MILESTONES } from '../progression/milestones';
import { INITIAL_PROGRESSION, TECH_TREE, type ProgressionState } from '../progression/research';
import { findCrew } from '../missions/crew';
import { findMission, findPayload, MISSIONS } from '../missions/missionCatalog';
import type { MissionSetup } from '../missions/missionSetup';
import type {
  BoosterRecoverySummary,
  FlightRecord,
  LandingSummary,
  LunarLandingOutcome,
  LunarSummary,
} from '../launch/flightRecord';
import type { FleetVehicle } from '../fleet/fleet';
import type { Grade } from '../recovery/rating';
import type { RecoveryTarget } from '../recovery/recoveryPlan';
import { CURRENT_SAVE_VERSION, migrateSave } from './migrations';

export type AssemblyMode = 'catalog' | 'structure';

export interface UiPrefs {
  readonly guideCollapsed: boolean;
  readonly assemblyMode: AssemblyMode;
  /** Risk-driven random failures during flight (on by default). */
  readonly randomFailures: boolean;
}

/** Versioned save data. Independent of Three.js and React. */
export interface SaveData {
  readonly saveVersion: typeof CURRENT_SAVE_VERSION;
  readonly savedAt: string;
  readonly activeBlueprintId: string;
  readonly blueprints: readonly RocketBlueprint[];
  readonly progression: ProgressionState;
  /** Mission Control plan (null until the player first opens Mission Control). */
  readonly mission: MissionSetup | null;
  /** Flight history, newest last. */
  readonly flights: readonly FlightRecord[];
  /** Recovered boosters and ships. */
  readonly fleet: readonly FleetVehicle[];
  readonly ui: UiPrefs;
}

export const SAVE_KEY = 'rocketworks.save';
export const CORRUPT_BACKUP_KEY = 'rocketworks.save.corrupt';
export const DEFAULT_UI: UiPrefs = {
  guideCollapsed: false,
  assemblyMode: 'catalog',
  randomFailures: true,
};

/** Most recent flights kept in the save. */
export const MAX_FLIGHT_RECORDS = 30;

/** Minimal Storage subset so tests and private-mode fallbacks can supply their own. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; data: SaveData; warnings: readonly string[] }
  | { status: 'corrupt'; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function parseInstance(raw: unknown): PartInstance | null {
  if (!isRecord(raw) || !isString(raw.id) || !isString(raw.partId) || !isRecord(raw.parent))
    return null;
  const { parentId, socketId } = raw.parent;
  if (!(parentId === null || isString(parentId)) || !isString(socketId)) return null;
  const rotationDeg = raw.rotationDeg ?? 0;
  if (typeof rotationDeg !== 'number' || !Number.isFinite(rotationDeg)) return null;
  return { id: raw.id, partId: raw.partId, parent: { parentId, socketId }, rotationDeg };
}

function parseCertification(raw: unknown): Certification | null {
  if (!isRecord(raw) || !isCount(raw.revision) || !isVehicleRole(raw.role) || !isString(raw.at))
    return null;
  return { revision: raw.revision, role: raw.role, override: raw.override === true, at: raw.at };
}

/** Runtime shape + integrity check for untrusted blueprint data (current schema only). */
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
  if (!isCount(raw.nextInstanceNumber) || !isCount(raw.revision) || !Array.isArray(raw.parts)) {
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
    name: raw.name.trim().slice(0, 40) || 'Unnamed Design',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    revision: raw.revision,
    nextInstanceNumber: raw.nextInstanceNumber,
    parts,
    // Cosmetic/role fields fall back to defaults instead of failing the whole design.
    finish: isHullFinish(raw.finish) ? raw.finish : 'brushed',
    role: isVehicleRole(raw.role) ? raw.role : 'crew',
    certification: raw.certification === null ? null : parseCertification(raw.certification),
  };
  const validation = validateBlueprint(blueprint);
  if (!validation.valid)
    return { ok: false, reason: validation.issues[0] ?? 'Blueprint failed validation.' };
  return { ok: true, blueprint };
}

function parseProgression(raw: unknown, warnings: string[]): ProgressionState {
  if (!isRecord(raw)) {
    if (raw !== undefined) warnings.push('Program progress was unreadable and has been reset.');
    return INITIAL_PROGRESSION;
  }
  const known = (list: unknown, ids: readonly string[]) =>
    Array.isArray(list)
      ? [...new Set(list.filter((x): x is string => isString(x) && ids.includes(x)))]
      : [];
  const milestones = known(
    raw.milestones,
    MILESTONES.map((m) => m.id),
  );
  const techIds = TECH_TREE.map((t) => t.id);
  // Drop tech whose prerequisites are missing so derived values stay consistent.
  const tech = known(raw.tech, techIds).filter((id) =>
    (TECH_TREE.find((t) => t.id === id)?.requires ?? []).every((r) =>
      (raw.tech as unknown[]).includes(r),
    ),
  );
  const completedMissions = known(
    raw.completedMissions,
    MISSIONS.map((m) => m.id),
  );
  return { milestones, tech, completedMissions };
}

const FLIGHT_RESULTS: readonly FlightRecord['result'][] = [
  'success',
  'partial',
  'failure',
  'aborted',
  'scrubbed',
];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const LANDING_OUTCOMES: readonly LandingSummary['outcome'][] = [
  'landed',
  'splashdown',
  'crash',
  'breakup',
  'stranded',
];

/** Optional orbital-flight landing summary (Stage 5); anything malformed is dropped. */
function parseLanding(raw: unknown): LandingSummary | undefined {
  if (
    !isRecord(raw) ||
    !LANDING_OUTCOMES.includes(raw.outcome as LandingSummary['outcome']) ||
    !isNum(raw.orbits) ||
    !isNum(raw.hull) ||
    !isNum(raw.shield) ||
    !isNum(raw.peakG) ||
    !isNum(raw.peakHeatKWm2)
  )
    return undefined;
  return {
    outcome: raw.outcome as LandingSummary['outcome'],
    zoneName: isString(raw.zoneName) ? raw.zoneName : null,
    missM: isNum(raw.missM) ? raw.missM : null,
    shipRecovered: raw.shipRecovered === true,
    orbits: raw.orbits,
    hull: raw.hull,
    shield: raw.shield,
    peakG: raw.peakG,
    peakHeatKWm2: raw.peakHeatKWm2,
    grade: parseGrade(raw.grade),
    manual: raw.manual === true,
  };
}

/** Flight history: malformed entries are dropped individually. */
function parseFlights(raw: unknown, warnings: string[]): FlightRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('Flight history was unreadable and has been cleared.');
    return [];
  }
  const out: FlightRecord[] = [];
  for (const r of raw) {
    if (
      isRecord(r) &&
      isString(r.id) &&
      isString(r.at) &&
      isString(r.missionId) &&
      isString(r.missionName) &&
      isString(r.designId) &&
      isString(r.designName) &&
      FLIGHT_RESULTS.includes(r.result as FlightRecord['result']) &&
      isString(r.summary) &&
      isNum(r.maxAltitudeM) &&
      isNum(r.maxSpeedMS) &&
      isNum(r.maxQPa) &&
      isNum(r.durationS) &&
      Array.isArray(r.events)
    ) {
      const landing = parseLanding(r.landing);
      const recovery = parseRecovery(r.recovery);
      const dock = isRecord(r.docking) ? r.docking : null;
      const docking =
        dock && isCount(dock.bounces) && isCount(dock.collisions) && isCount(dock.violations)
          ? {
              grade: parseGrade(dock.grade),
              manual: dock.manual === true,
              bounces: dock.bounces,
              collisions: dock.collisions,
              violations: dock.violations,
              tasksDone: dock.tasksDone === true,
            }
          : null;
      const hw = isRecord(r.hardware) ? r.hardware : null;
      const lunar = parseLunar(r.lunar);
      out.push({
        id: r.id,
        at: r.at,
        missionId: r.missionId,
        missionName: r.missionName,
        designId: r.designId,
        designName: r.designName,
        result: r.result as FlightRecord['result'],
        summary: r.summary,
        credited: r.credited === true,
        crewSafe: typeof r.crewSafe === 'boolean' ? r.crewSafe : null,
        maxAltitudeM: r.maxAltitudeM,
        maxSpeedMS: r.maxSpeedMS,
        maxQPa: r.maxQPa,
        durationS: r.durationS,
        events: r.events.filter(isString).slice(0, 60),
        ...(landing ? { landing } : {}),
        ...(recovery ? { recovery } : {}),
        ...(docking ? { docking } : {}),
        ...(lunar ? { lunar } : {}),
        ...(hw
          ? {
              hardware: {
                boosterId: isString(hw.boosterId) ? hw.boosterId : null,
                shipId: isString(hw.shipId) ? hw.shipId : null,
              },
            }
          : {}),
      });
    }
  }
  if (out.length < raw.length)
    warnings.push(`${raw.length - out.length} damaged flight record(s) were skipped.`);
  return out.slice(-MAX_FLIGHT_RECORDS);
}

/** Mission setup is optional; anything unreadable is dropped (the player just re-plans). */
function parseMissionSetup(
  raw: unknown,
  designIds: readonly string[],
  warnings: string[],
): MissionSetup | null {
  if (raw === null || raw === undefined) return null;
  const ok =
    isRecord(raw) &&
    isString(raw.missionId) &&
    !!findMission(raw.missionId) &&
    (raw.designId === null || isString(raw.designId)) &&
    Array.isArray(raw.crewIds) &&
    isString(raw.payloadId) &&
    !!findPayload(raw.payloadId) &&
    isCount(raw.conditionsSeed) &&
    isCount(raw.waits);
  if (!ok) {
    warnings.push('The saved mission plan was unreadable and has been cleared.');
    return null;
  }
  const crewIds = [
    ...new Set((raw.crewIds as unknown[]).filter((c): c is string => isString(c) && !!findCrew(c))),
  ];
  const designId = isString(raw.designId) && designIds.includes(raw.designId) ? raw.designId : null;
  const c = raw.commit;
  const commit =
    isRecord(c) && isString(c.designId) && isCount(c.revision) && isString(c.at)
      ? { designId: c.designId, revision: c.revision, at: c.at }
      : null;
  return {
    missionId: raw.missionId as string,
    designId,
    crewIds,
    payloadId: raw.payloadId as string,
    conditionsSeed: raw.conditionsSeed as number,
    waits: raw.waits as number,
    commit,
    recovery: RECOVERY_TARGETS.includes(raw.recovery as RecoveryTarget)
      ? (raw.recovery as RecoveryTarget)
      : null,
    boosterFleetId: isString(raw.boosterFleetId) ? raw.boosterFleetId : null,
    shipFleetId: isString(raw.shipFleetId) ? raw.shipFleetId : null,
    refuel: isRecord(raw.refuel)
      ? { leo: raw.refuel.leo === true, depot: raw.refuel.depot === true }
      : { leo: false, depot: false },
  };
}

const LUNAR_OUTCOMES: readonly LunarLandingOutcome[] = ['landed', 'tipped', 'crashed'];

/** Moon-mission summary on a flight record (Stage 8+); malformed parts are dropped. */
function parseLunar(raw: unknown): LunarSummary | null {
  if (!isRecord(raw)) return null;
  const l = isRecord(raw.landing) ? raw.landing : null;
  const landing =
    l &&
    isString(l.siteId) &&
    isString(l.siteName) &&
    LUNAR_OUTCOMES.includes(l.outcome as LunarLandingOutcome) &&
    isNum(l.missM)
      ? {
          siteId: l.siteId,
          siteName: l.siteName,
          outcome: l.outcome as LunarLandingOutcome,
          grade: parseGrade(l.grade),
          manual: l.manual === true,
          missM: l.missM,
        }
      : null;
  return {
    closestAltM: isNum(raw.closestAltM) ? raw.closestAltM : null,
    flyby: raw.flyby === true,
    lunarOrbit: raw.lunarOrbit === true,
    refuels: isCount(raw.refuels) ? raw.refuels : 0,
    landing,
    surfaceDone: raw.surfaceDone === true,
    ascent: raw.ascent === true,
    earthReturn: raw.earthReturn === true,
  };
}

const RECOVERY_TARGETS: readonly RecoveryTarget[] = ['catch', 'platform', 'expend'];
const GRADES: readonly Grade[] = ['S', 'A', 'B', 'C', 'D'];
const parseGrade = (v: unknown): Grade | null =>
  GRADES.includes(v as Grade) ? (v as Grade) : null;

/** Fleet: malformed vehicles are dropped individually. */
function parseFleet(raw: unknown, warnings: string[]): FleetVehicle[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The fleet list was unreadable and has been cleared.');
    return [];
  }
  const out: FleetVehicle[] = [];
  for (const v of raw) {
    if (
      isRecord(v) &&
      isString(v.id) &&
      (v.kind === 'booster' || v.kind === 'ship') &&
      isString(v.name) &&
      isString(v.designId) &&
      isString(v.designName) &&
      isString(v.signature) &&
      isCount(v.flights) &&
      isNum(v.wear) &&
      isString(v.recoveredAt) &&
      !out.some((o) => o.id === v.id)
    ) {
      out.push({
        id: v.id,
        kind: v.kind,
        name: v.name,
        designId: v.designId,
        designName: v.designName,
        signature: v.signature,
        flights: v.flights,
        wear: Math.max(0, Math.min(1, v.wear)),
        lastGrade: parseGrade(v.lastGrade),
        recoveredAt: v.recoveredAt,
        refurbPending: v.refurbPending === true,
      });
    }
  }
  if (out.length < raw.length)
    warnings.push(`${raw.length - out.length} damaged fleet record(s) were skipped.`);
  return out;
}

const BOOSTER_OUTCOMES: readonly BoosterRecoverySummary['outcome'][] = [
  'caught',
  'landed',
  'lost',
  'expended',
  'not-attempted',
];

function parseRecovery(raw: unknown): BoosterRecoverySummary | undefined {
  if (
    !isRecord(raw) ||
    !RECOVERY_TARGETS.includes(raw.target as RecoveryTarget) ||
    !BOOSTER_OUTCOMES.includes(raw.outcome as BoosterRecoverySummary['outcome']) ||
    !isNum(raw.heatLoadMJm2) ||
    !isString(raw.summary)
  )
    return undefined;
  return {
    target: raw.target as RecoveryTarget,
    outcome: raw.outcome as BoosterRecoverySummary['outcome'],
    grade: parseGrade(raw.grade),
    manual: raw.manual === true,
    simulated: raw.simulated === true,
    missM: isNum(raw.missM) ? raw.missM : null,
    vertMS: isNum(raw.vertMS) ? raw.vertMS : null,
    heatLoadMJm2: raw.heatLoadMJm2,
    summary: raw.summary,
  };
}

/** Parses a save string. Damaged designs are skipped with a warning; the save is corrupt only if nothing usable remains. */
export function parseSave(json: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { status: 'corrupt', reason: 'Save file is not valid JSON.' };
  }
  const migrated = migrateSave(raw);
  if (!migrated.ok) return { status: 'corrupt', reason: migrated.reason };
  const data = migrated.data;
  const warnings: string[] = [];
  if (migrated.migratedFrom) warnings.push(`Save upgraded from version ${migrated.migratedFrom}.`);

  if (!Array.isArray(data.blueprints))
    return { status: 'corrupt', reason: 'Save has no design list.' };
  const blueprints: RocketBlueprint[] = [];
  for (const [i, item] of data.blueprints.entries()) {
    const parsed = parseBlueprint(item);
    const label = isRecord(item) && isString(item.name) ? `"${item.name}"` : `#${i + 1}`;
    if (!parsed.ok) {
      warnings.push(`Design ${label} was damaged and skipped (${parsed.reason})`);
    } else if (blueprints.some((b) => b.id === parsed.blueprint.id)) {
      warnings.push(`Duplicate design ${label} was skipped.`);
    } else if (blueprints.length >= MAX_BLUEPRINTS) {
      warnings.push(`Design ${label} exceeds the ${MAX_BLUEPRINTS}-design limit and was skipped.`);
    } else {
      blueprints.push(parsed.blueprint);
    }
  }
  const first = blueprints[0];
  if (!first) {
    return {
      status: 'corrupt',
      reason: warnings.find((w) => w.startsWith('Design')) ?? 'Save contains no usable designs.',
    };
  }
  let activeBlueprintId = isString(data.activeBlueprintId) ? data.activeBlueprintId : '';
  if (!blueprints.some((b) => b.id === activeBlueprintId)) {
    if (activeBlueprintId)
      warnings.push('The active design was missing; opened the first one instead.');
    activeBlueprintId = first.id;
  }
  const ui = isRecord(data.ui) ? data.ui : {};
  return {
    status: 'loaded',
    warnings,
    data: {
      saveVersion: CURRENT_SAVE_VERSION,
      savedAt: isString(data.savedAt) ? data.savedAt : first.updatedAt,
      activeBlueprintId,
      blueprints,
      progression: parseProgression(data.progression, warnings),
      mission: parseMissionSetup(
        data.mission,
        blueprints.map((b) => b.id),
        warnings,
      ),
      flights: parseFlights(data.flights, warnings),
      fleet: parseFleet(data.fleet, warnings),
      ui: {
        guideCollapsed: ui.guideCollapsed === true,
        assemblyMode: ui.assemblyMode === 'structure' ? 'structure' : 'catalog',
        randomFailures: ui.randomFailures !== false,
      },
    },
  };
}

/** Reads the save; never throws. Damaged data is backed up so it is not silently lost. */
export function loadGame(storage: KeyValueStorage): LoadResult {
  let json: string | null;
  try {
    json = storage.getItem(SAVE_KEY);
  } catch {
    return { status: 'corrupt', reason: 'Browser storage is unavailable.' };
  }
  if (json === null) return { status: 'empty' };
  const result = parseSave(json);
  const damaged =
    result.status === 'corrupt' ||
    (result.status === 'loaded' && result.warnings.some((w) => !w.startsWith('Save upgraded')));
  if (damaged) {
    try {
      storage.setItem(CORRUPT_BACKUP_KEY, json);
    } catch {
      /* best effort */
    }
  }
  return result;
}

export function serializeSave(data: Omit<SaveData, 'saveVersion'>): string {
  const full: SaveData = { ...data, saveVersion: CURRENT_SAVE_VERSION };
  return JSON.stringify(full);
}

export function writeSave(
  storage: KeyValueStorage,
  data: Omit<SaveData, 'saveVersion'>,
): { ok: true } | { ok: false; reason: string } {
  try {
    storage.setItem(SAVE_KEY, serializeSave(data));
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
