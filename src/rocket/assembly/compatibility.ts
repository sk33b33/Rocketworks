import { findPart, SOCKET_TYPE_LABELS } from '../catalog/parts';
import type {
  PartDefinition,
  PartInstance,
  RocketBlueprint,
  SocketDefinition,
  SocketRef,
} from '../model/types';

/** The single root slot on the factory's assembly stand. */
export const STAND_SOCKET: SocketDefinition = {
  id: 'stand',
  name: 'Assembly stand',
  type: 'root',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export type Check = { ok: true } | { ok: false; reason: string };

/** Unlock state comes from the definition plus any parts unlocked through progression. */
export function isPartUnlocked(part: PartDefinition, unlockedIds?: ReadonlySet<string>): boolean {
  return part.unlock.unlocked || (unlockedIds?.has(part.id) ?? false);
}

export function findInstance(bp: RocketBlueprint, id: string): PartInstance | undefined {
  return bp.parts.find((p) => p.id === id);
}

export function sameRef(a: SocketRef, b: SocketRef): boolean {
  return a.parentId === b.parentId && a.socketId === b.socketId;
}

export interface ResolvedSocket {
  readonly socket: SocketDefinition;
  readonly parent: PartInstance | null;
  readonly parentPart: PartDefinition | null;
}

export function resolveSocket(bp: RocketBlueprint, ref: SocketRef): ResolvedSocket | undefined {
  if (ref.parentId === null) {
    return ref.socketId === STAND_SOCKET.id
      ? { socket: STAND_SOCKET, parent: null, parentPart: null }
      : undefined;
  }
  const parent = findInstance(bp, ref.parentId);
  const parentPart = parent && findPart(parent.partId);
  const socket = parentPart?.sockets.find((s) => s.id === ref.socketId);
  return parent && parentPart && socket ? { socket, parent, parentPart } : undefined;
}

export function occupantOf(bp: RocketBlueprint, ref: SocketRef): PartInstance | undefined {
  return bp.parts.find((p) => sameRef(p.parent, ref));
}

export function describeSocket(bp: RocketBlueprint, ref: SocketRef): string {
  const resolved = resolveSocket(bp, ref);
  if (!resolved) return 'Unknown attachment point';
  return resolved.parentPart
    ? `${resolved.parentPart.name} › ${resolved.socket.name}`
    : resolved.socket.name;
}

/** Deterministic attach rule check with a player-readable reason on failure. */
export function canAttach(
  bp: RocketBlueprint,
  partId: string,
  ref: SocketRef,
  unlockedIds?: ReadonlySet<string>,
): Check {
  const part = findPart(partId);
  if (!part) return { ok: false, reason: `Unknown part "${partId}".` };
  if (!isPartUnlocked(part, unlockedIds)) {
    return {
      ok: false,
      reason: `${part.name} is locked. ${part.unlock.unlocked ? '' : part.unlock.reason}`.trim(),
    };
  }
  const resolved = resolveSocket(bp, ref);
  if (!resolved)
    return { ok: false, reason: 'That attachment point does not exist on the current build.' };
  const occupant = occupantOf(bp, ref);
  if (occupant) {
    const name = findPart(occupant.partId)?.name ?? 'another part';
    return {
      ok: false,
      reason: `${describeSocket(bp, ref)} is already occupied by ${name}. Remove it first.`,
    };
  }
  if (resolved.socket.type !== part.attachesTo) {
    return {
      ok: false,
      reason: `${part.name} attaches to ${SOCKET_TYPE_LABELS[part.attachesTo]}, but this is ${SOCKET_TYPE_LABELS[resolved.socket.type]}.`,
    };
  }
  return { ok: true };
}

export interface FreeSocket {
  readonly ref: SocketRef;
  readonly socket: SocketDefinition;
}

/** Every unoccupied socket on the build, plus the stand when the build is empty. */
export function listFreeSockets(bp: RocketBlueprint): FreeSocket[] {
  const occupied = new Set(bp.parts.map((p) => `${p.parent.parentId ?? ''}/${p.parent.socketId}`));
  const free: FreeSocket[] = [];
  if (!occupied.has(`/${STAND_SOCKET.id}`)) {
    free.push({ ref: { parentId: null, socketId: STAND_SOCKET.id }, socket: STAND_SOCKET });
  }
  for (const instance of bp.parts) {
    const def = findPart(instance.partId);
    for (const socket of def?.sockets ?? []) {
      if (!occupied.has(`${instance.id}/${socket.id}`)) {
        free.push({ ref: { parentId: instance.id, socketId: socket.id }, socket });
      }
    }
  }
  return free;
}

export interface AttachTarget extends FreeSocket {
  readonly check: Check;
}

/** Free sockets annotated with whether the given part may attach there. */
export function listTargets(
  bp: RocketBlueprint,
  partId: string,
  unlockedIds?: ReadonlySet<string>,
): AttachTarget[] {
  return listFreeSockets(bp).map((free) => ({
    ...free,
    check: canAttach(bp, partId, free.ref, unlockedIds),
  }));
}

export function compatibleTargets(
  bp: RocketBlueprint,
  partId: string,
  unlockedIds?: ReadonlySet<string>,
): FreeSocket[] {
  return listTargets(bp, partId, unlockedIds).filter((t) => t.check.ok);
}
