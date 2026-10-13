import { findPart, getPart } from '../catalog/parts';
import type { PartInstance, RocketBlueprint, SocketRef } from '../model/types';
import { canAttach, compatibleTargets, findInstance, resolveSocket } from './compatibility';

/*
 * Pure blueprint operations. Each returns a new blueprint (never mutates) or a reason for refusal.
 * `now` is injected so results are deterministic in tests.
 */

export type OpResult<T = object> =
  ({ ok: true; blueprint: RocketBlueprint } & T) | { ok: false; reason: string };

function touch(
  bp: RocketBlueprint,
  parts: readonly PartInstance[],
  now: string,
  nextInstanceNumber = bp.nextInstanceNumber,
): RocketBlueprint {
  return { ...bp, parts, nextInstanceNumber, updatedAt: now };
}

export function attachPart(
  bp: RocketBlueprint,
  partId: string,
  ref: SocketRef,
  now: string,
  unlockedIds?: ReadonlySet<string>,
): OpResult<{ instanceId: string }> {
  const check = canAttach(bp, partId, ref, unlockedIds);
  if (!check.ok) return check;
  const instanceId = `p${bp.nextInstanceNumber}`;
  const instance: PartInstance = { id: instanceId, partId, parent: ref, rotationDeg: 0 };
  return {
    ok: true,
    instanceId,
    blueprint: touch(bp, [...bp.parts, instance], now, bp.nextInstanceNumber + 1),
  };
}

/** IDs of the instance and everything attached below it, in blueprint order. */
export function subtreeIds(bp: RocketBlueprint, rootId: string): string[] {
  const ids = new Set<string>([rootId]);
  for (const p of bp.parts) {
    if (p.parent.parentId !== null && ids.has(p.parent.parentId)) ids.add(p.id);
  }
  return bp.parts.filter((p) => ids.has(p.id)).map((p) => p.id);
}

/** Removes the instance and every part attached to it. */
export function removePart(
  bp: RocketBlueprint,
  instanceId: string,
  now: string,
): OpResult<{ removedCount: number }> {
  if (!findInstance(bp, instanceId))
    return { ok: false, reason: 'That part is no longer on the build.' };
  const remove = new Set(subtreeIds(bp, instanceId));
  return {
    ok: true,
    removedCount: remove.size,
    blueprint: touch(
      bp,
      bp.parts.filter((p) => !remove.has(p.id)),
      now,
    ),
  };
}

/**
 * Swaps an instance's part definition in place. Children whose socket still exists (same id and
 * type) on the new part stay attached; the rest are removed along with their subtrees.
 */
export function replacePart(
  bp: RocketBlueprint,
  instanceId: string,
  newPartId: string,
  now: string,
  unlockedIds?: ReadonlySet<string>,
): OpResult<{ droppedCount: number }> {
  const instance = findInstance(bp, instanceId);
  if (!instance) return { ok: false, reason: 'That part is no longer on the build.' };
  if (instance.partId === newPartId)
    return { ok: false, reason: 'That is already the installed part.' };

  // Check compatibility as if the socket were empty.
  const without = { ...bp, parts: bp.parts.filter((p) => p.id !== instanceId) };
  const check = canAttach(without, newPartId, instance.parent, unlockedIds);
  if (!check.ok) return check;

  const newPart = getPart(newPartId);
  const oldPart = getPart(instance.partId);
  const drop = new Set<string>();
  for (const child of bp.parts) {
    if (child.parent.parentId !== instanceId) continue;
    const oldSocket = oldPart.sockets.find((s) => s.id === child.parent.socketId);
    const newSocket = newPart.sockets.find((s) => s.id === child.parent.socketId);
    if (!newSocket || newSocket.type !== oldSocket?.type) {
      for (const id of subtreeIds(bp, child.id)) drop.add(id);
    }
  }
  const step = newPart.rotationStepDeg;
  const rotationDeg = step && instance.rotationDeg % step === 0 ? instance.rotationDeg : 0;
  const parts = bp.parts
    .filter((p) => !drop.has(p.id))
    .map((p) => (p.id === instanceId ? { ...p, partId: newPartId, rotationDeg } : p));
  return { ok: true, droppedCount: drop.size, blueprint: touch(bp, parts, now) };
}

export function rotatePart(
  bp: RocketBlueprint,
  instanceId: string,
  now: string,
): OpResult<{ rotationDeg: number }> {
  const instance = findInstance(bp, instanceId);
  const part = instance && findPart(instance.partId);
  if (!instance || !part) return { ok: false, reason: 'That part is no longer on the build.' };
  if (!part.rotationStepDeg) return { ok: false, reason: `${part.name} has a fixed orientation.` };
  const rotationDeg = (instance.rotationDeg + part.rotationStepDeg) % 360;
  const parts = bp.parts.map((p) => (p.id === instanceId ? { ...p, rotationDeg } : p));
  return { ok: true, rotationDeg, blueprint: touch(bp, parts, now) };
}

/**
 * Attaches the part to every currently free compatible socket (sockets created by the new parts are
 * not filled, so stack sections are added once). Optional filter narrows the targets.
 */
export function fillCompatible(
  bp: RocketBlueprint,
  partId: string,
  now: string,
  unlockedIds?: ReadonlySet<string>,
  filter: (ref: SocketRef, bp: RocketBlueprint) => boolean = () => true,
): OpResult<{ attachedCount: number }> {
  const targets = compatibleTargets(bp, partId, unlockedIds).filter((t) => filter(t.ref, bp));
  if (targets.length === 0) {
    const part = findPart(partId);
    return { ok: false, reason: `No free attachment point accepts ${part?.name ?? partId}.` };
  }
  let current = bp;
  for (const target of targets) {
    const result = attachPart(current, partId, target.ref, now, unlockedIds);
    if (result.ok) current = result.blueprint;
  }
  return { ok: true, attachedCount: targets.length, blueprint: current };
}

/** Part definition id of the instance that owns a socket (undefined for the stand). */
export function socketOwnerPartId(bp: RocketBlueprint, ref: SocketRef): string | undefined {
  return resolveSocket(bp, ref)?.parentPart?.id;
}
