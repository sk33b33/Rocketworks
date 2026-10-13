import { findPart } from '../catalog/parts';
import { BLUEPRINT_SCHEMA_VERSION, type RocketBlueprint } from '../model/types';
import { STAND_SOCKET } from './compatibility';

export interface BlueprintValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

/**
 * Structural integrity check: every connection must reference a known part, an earlier parent and
 * an existing socket of the right type, and no socket may hold two parts. Used for loaded saves and
 * as an invariant in tests. Lock state is not checked here.
 */
export function validateBlueprint(bp: RocketBlueprint): BlueprintValidation {
  const issues: string[] = [];
  if (bp.schemaVersion !== BLUEPRINT_SCHEMA_VERSION)
    issues.push(`Unsupported blueprint schema ${String(bp.schemaVersion)}.`);

  const seen = new Map<string, string>(); // instance id -> part id
  const occupied = new Set<string>();
  let maxNumber = 0;

  for (const [index, inst] of bp.parts.entries()) {
    const label = `Part #${index + 1} (${inst.id})`;
    if (seen.has(inst.id)) issues.push(`${label}: duplicate instance id.`);
    const match = /^p(\d+)$/.exec(inst.id);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));

    const part = findPart(inst.partId);
    if (!part) issues.push(`${label}: unknown part "${inst.partId}".`);

    const key = `${inst.parent.parentId ?? ''}/${inst.parent.socketId}`;
    if (occupied.has(key)) issues.push(`${label}: attachment point already occupied.`);
    occupied.add(key);

    if (inst.parent.parentId === null) {
      if (inst.parent.socketId !== STAND_SOCKET.id) issues.push(`${label}: unknown root slot.`);
      else if (part && part.attachesTo !== 'root')
        issues.push(`${label}: ${part.name} cannot sit on the assembly stand.`);
    } else {
      const parentPartId = seen.get(inst.parent.parentId);
      if (!parentPartId) {
        issues.push(
          `${label}: parent ${inst.parent.parentId} is missing or listed after its child.`,
        );
      } else {
        const socket = findPart(parentPartId)?.sockets.find((s) => s.id === inst.parent.socketId);
        if (!socket) issues.push(`${label}: parent has no socket "${inst.parent.socketId}".`);
        else if (part && socket.type !== part.attachesTo)
          issues.push(`${label}: ${part.name} does not fit ${socket.name}.`);
      }
    }

    if (part) {
      const step = part.rotationStepDeg;
      const okRotation = step
        ? inst.rotationDeg % step === 0 && inst.rotationDeg >= 0 && inst.rotationDeg < 360
        : inst.rotationDeg === 0;
      if (!okRotation) issues.push(`${label}: invalid rotation ${inst.rotationDeg}°.`);
    }
    seen.set(inst.id, inst.partId);
  }

  if (bp.nextInstanceNumber <= maxNumber)
    issues.push('Instance counter is behind existing part ids.');
  return { valid: issues.length === 0, issues };
}
