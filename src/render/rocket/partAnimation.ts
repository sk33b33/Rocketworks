import type * as THREE from 'three';
import { findPart } from '../../rocket/catalog/parts';
import type { RocketBlueprint } from '../../rocket/model/types';
import { instanceStages } from '../../rocket/stats/calculateRocketStats';
import type { BlueprintRenderer } from './BlueprintRenderer';

/*
 * Moving parts. Each part mesh is the first child of its instance group and is built in its
 * socket frame (x = outward, y = up along the hull, z = tangential), so deployments are simple
 * rotations of that child about its attachment point.
 */

export interface MovingParts {
  readonly gridFins: THREE.Object3D[];
  readonly legs: THREE.Object3D[];
  readonly flapsForward: THREE.Object3D[];
  readonly flapsAft: THREE.Object3D[];
}

/** Collects the moving parts of one stage (or all stages if `stage` is omitted). */
export function collectMovingParts(
  renderer: BlueprintRenderer,
  bp: RocketBlueprint,
  stage?: 'booster' | 'ship',
): MovingParts {
  const stages = instanceStages(bp);
  const pick = (partId: string) =>
    bp.parts
      .filter((p) => p.partId === partId && (!stage || stages.get(p.id) === stage))
      .map((p) => renderer.getInstanceNode(p.id)?.children[0])
      .filter((o): o is THREE.Object3D => !!o && !!findPart(partId));
  return {
    gridFins: pick('grid-fin'),
    legs: pick('landing-leg'),
    flapsForward: pick('flap-forward'),
    flapsAft: pick('flap-aft'),
  };
}

/** 0 = folded up against the hull, 1 = deployed straight out. */
export function setGridFins(parts: MovingParts, deploy: number): void {
  for (const o of parts.gridFins) o.rotation.z = (1 - clamp01(deploy)) * (Math.PI / 2);
}

/** 0 = stowed along the hull, 1 = splayed out for touchdown. */
export function setLegs(parts: MovingParts, deploy: number): void {
  for (const o of parts.legs) o.rotation.z = clamp01(deploy) * 0.45;
}

/** Flap deflection about the hinge (radians). */
export function setFlaps(parts: MovingParts, forward: number, aft: number): void {
  for (const o of parts.flapsForward) o.rotation.y = forward;
  for (const o of parts.flapsAft) o.rotation.y = aft;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
