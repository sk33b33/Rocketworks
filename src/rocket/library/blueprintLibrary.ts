import { touch } from '../assembly/operations';
import { createStarterBlueprint } from '../catalog/blueprints';
import type { HullFinish, RocketBlueprint, VehicleRole } from '../model/types';

/** Pure operations on the player's set of saved designs. */

export const MAX_BLUEPRINTS = 12;
export const MAX_NAME_LENGTH = 40;

export type LibResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

export function normalizeName(raw: string): LibResult<{ name: string }> {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, reason: 'Design name cannot be empty.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `Design name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  return { ok: true, name };
}

/** "Base", "Base (2)", "Base (3)"… avoiding names already in use. */
export function uniqueName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const trimmed = base.slice(0, MAX_NAME_LENGTH - 5);
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  for (let i = 2; ; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function roomCheck(list: readonly RocketBlueprint[]): LibResult<object> {
  return list.length >= MAX_BLUEPRINTS
    ? { ok: false, reason: `You can keep up to ${MAX_BLUEPRINTS} designs. Delete one first.` }
    : { ok: true };
}

export function addNewBlueprint(
  list: readonly RocketBlueprint[],
  id: string,
  now: string,
): LibResult<{ list: RocketBlueprint[]; blueprint: RocketBlueprint }> {
  const room = roomCheck(list);
  if (!room.ok) return room;
  const name = uniqueName(
    'New Design',
    list.map((b) => b.name),
  );
  const blueprint = createStarterBlueprint(now, name, id);
  return { ok: true, blueprint, list: [...list, blueprint] };
}

export function duplicateBlueprint(
  list: readonly RocketBlueprint[],
  sourceId: string,
  id: string,
  now: string,
): LibResult<{ list: RocketBlueprint[]; blueprint: RocketBlueprint }> {
  const room = roomCheck(list);
  if (!room.ok) return room;
  const source = list.find((b) => b.id === sourceId);
  if (!source) return { ok: false, reason: 'That design no longer exists.' };
  const blueprint: RocketBlueprint = {
    ...source,
    id,
    name: uniqueName(
      `${source.name} copy`,
      list.map((b) => b.name),
    ),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    certification: null,
  };
  const index = list.findIndex((b) => b.id === sourceId);
  return {
    ok: true,
    blueprint,
    list: [...list.slice(0, index + 1), blueprint, ...list.slice(index + 1)],
  };
}

/** Deletes a design and returns the id that should become active (neighbour of the deleted one). */
export function deleteBlueprint(
  list: readonly RocketBlueprint[],
  id: string,
  activeId: string,
): LibResult<{ list: RocketBlueprint[]; activeId: string }> {
  if (list.length <= 1) return { ok: false, reason: 'You must keep at least one design.' };
  const index = list.findIndex((b) => b.id === id);
  if (index < 0) return { ok: false, reason: 'That design no longer exists.' };
  const next = list.filter((b) => b.id !== id);
  const newActive =
    id === activeId ? (next[Math.min(index, next.length - 1)]?.id ?? next[0]!.id) : activeId;
  return { ok: true, list: next, activeId: newActive };
}

export function renameBlueprint(
  list: readonly RocketBlueprint[],
  id: string,
  rawName: string,
  now: string,
): LibResult<{ blueprint: RocketBlueprint }> {
  const bp = list.find((b) => b.id === id);
  if (!bp) return { ok: false, reason: 'That design no longer exists.' };
  const n = normalizeName(rawName);
  if (!n.ok) return n;
  if (list.some((b) => b.id !== id && b.name.toLowerCase() === n.name.toLowerCase())) {
    return { ok: false, reason: `Another design is already called "${n.name}".` };
  }
  return { ok: true, blueprint: { ...bp, name: n.name, updatedAt: now } };
}

/** Cosmetic; does not change the revision, so certifications stay valid. */
export function setFinish(bp: RocketBlueprint, finish: HullFinish, now: string): RocketBlueprint {
  return { ...bp, finish, updatedAt: now };
}

/** Changing the role changes the readiness rules, so it is a design change. */
export function setRole(bp: RocketBlueprint, role: VehicleRole, now: string): RocketBlueprint {
  return bp.role === role ? bp : { ...touch(bp, bp.parts, now), role };
}

export function replaceInList(
  list: readonly RocketBlueprint[],
  bp: RocketBlueprint,
): RocketBlueprint[] {
  return list.map((b) => (b.id === bp.id ? bp : b));
}
