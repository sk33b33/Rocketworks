import { listFreeSockets } from '../rocket/assembly/compatibility';
import { findPart } from '../rocket/catalog/parts';
import { HULL_RADIUS_M } from '../rocket/model/geometry';
import type { RocketBlueprint } from '../rocket/model/types';
import { instanceStages } from '../rocket/stats/calculateRocketStats';
import { deriveFlightVehicle, type StageParams } from '../simulation/ascent/flightVehicle';
import { EARTH_RADIUS_M } from '../simulation/constants';
import type { AscentState } from '../simulation/ascent/ascentModel';
import type { ShipSpec } from './flightModel';
import type { Vec2 } from './orbitMath';

const SHIP_SECTIONS = [
  'ship-aft-section',
  'ship-tank',
  'ship-tank-extended',
  'crew-cabin',
  'cargo-bay',
  'nose-cone',
];

/** Ship-only flight parameters from a design (payload/crew mass rides as dry mass). */
export function deriveShipSpec(bp: RocketBlueprint, carriedMassKg: number): ShipSpec {
  return shipSpecFor(bp, deriveFlightVehicle(bp, carriedMassKg).ship);
}

/** Ship spec from an already-derived ship stage (e.g. the one the ascent flew). */
export function shipSpecFor(bp: RocketBlueprint, stage: StageParams): ShipSpec {
  const stages = instanceStages(bp);
  const sections = bp.parts.filter((p) => SHIP_SECTIONS.includes(p.partId));
  const bare = listFreeSockets(bp).filter((f) => f.socket.type === 'heat-shield').length;
  const lengthM = bp.parts
    .filter((p) => stages.get(p.id) === 'ship')
    .reduce((s, p) => s + (findPart(p.partId)?.heightM ?? 0), 0);
  return {
    stage,
    shieldCoverage: sections.length ? (sections.length - bare) / sections.length : 0,
    hasFlaps:
      bp.parts.filter((p) => p.partId === 'flap-forward').length >= 2 &&
      bp.parts.filter((p) => p.partId === 'flap-aft').length >= 2,
    lengthM: Math.max(10, lengthM),
    radiusM: HULL_RADIUS_M,
    hasDockingAdapter: bp.parts.some((p) => p.partId === 'docking-adapter'),
  };
}

/** Converts the ascent's (downrange, altitude, vH, vV) into Earth-centred position/velocity. */
export function ascentToInertial(
  s: Pick<AscentState, 'downrangeM' | 'altitudeM' | 'vHorizMS' | 'vVertMS'>,
): { r: Vec2; v: Vec2 } {
  const phi = s.downrangeM / EARTH_RADIUS_M;
  const d = EARTH_RADIUS_M + s.altitudeM;
  const up: Vec2 = [Math.sin(phi), Math.cos(phi)];
  const east: Vec2 = [up[1], -up[0]];
  return {
    r: [up[0] * d, up[1] * d],
    v: [east[0] * s.vHorizMS + up[0] * s.vVertMS, east[1] * s.vHorizMS + up[1] * s.vVertMS],
  };
}

/** The ship's part subtree as a stand-alone blueprint (for rendering the ship on its own). */
export function shipOnlyBlueprint(bp: RocketBlueprint): RocketBlueprint {
  const root = bp.parts.find((p) => p.partId === 'ship-aft-section');
  if (!root) return { ...bp, parts: [] };
  const keep = new Set([root.id]);
  for (const p of bp.parts) if (p.parent.parentId && keep.has(p.parent.parentId)) keep.add(p.id);
  return {
    ...bp,
    parts: bp.parts
      .filter((p) => keep.has(p.id))
      .map((p) => (p.id === root.id ? { ...p, parent: { parentId: null, socketId: 'stand' } } : p)),
  };
}
