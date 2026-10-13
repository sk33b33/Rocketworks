import { findPart } from '../../rocket/catalog/parts';
import { HULL_RADIUS_M } from '../../rocket/model/geometry';
import type { RocketBlueprint } from '../../rocket/model/types';
import { instanceStages } from '../../rocket/stats/calculateRocketStats';

/** Lumped propulsion/mass parameters for one stage, derived from the blueprint. */
export interface StageParams {
  readonly dryMassKg: number;
  readonly propellantKg: number;
  readonly engineCount: number;
  /** Per-engine thrust at sea level and in vacuum (averaged over the stage's engines). */
  readonly thrustSlPerEngineN: number;
  readonly thrustVacPerEngineN: number;
  readonly ispSlS: number;
  readonly ispVacS: number;
}

export interface FlightVehicle {
  readonly booster: StageParams;
  /** Ship dry mass includes the carried payload and crew (never burned). */
  readonly ship: StageParams;
  readonly referenceAreaM2: number;
  readonly dragCoefficient: number;
}

/** Simplified drag coefficient for the whole stack (gameplay value). */
export const STACK_DRAG_COEFFICIENT = 0.45;

/**
 * Builds simulation parameters from a design. Vacuum thrust scales sea-level thrust by the Isp
 * ratio, a common simplification for a fixed-throat engine.
 */
export function deriveFlightVehicle(bp: RocketBlueprint, carriedMassKg = 0): FlightVehicle {
  const stages = instanceStages(bp);
  const acc = {
    booster: { dry: 0, prop: 0, n: 0, tsl: 0, tvac: 0, isl: 0, ivac: 0 },
    ship: { dry: 0, prop: 0, n: 0, tsl: 0, tvac: 0, isl: 0, ivac: 0 },
  };
  for (const inst of bp.parts) {
    const part = findPart(inst.partId);
    if (!part) continue;
    const a = acc[stages.get(inst.id) ?? 'booster'];
    a.dry += part.dryMassKg;
    a.prop += part.propellantCapacityKg ?? 0;
    if (part.thrustN) {
      const sl = part.ispSeaLevelS ?? 300;
      const vac = part.ispVacuumS ?? sl;
      a.n += 1;
      a.tsl += part.thrustN;
      a.tvac += part.thrustN * (vac / sl);
      a.isl += sl * part.thrustN;
      a.ivac += vac * part.thrustN;
    }
  }
  const toStage = (a: typeof acc.booster, extraDry = 0): StageParams => ({
    dryMassKg: a.dry + extraDry,
    propellantKg: a.prop,
    engineCount: a.n,
    thrustSlPerEngineN: a.n ? a.tsl / a.n : 0,
    thrustVacPerEngineN: a.n ? a.tvac / a.n : 0,
    ispSlS: a.tsl ? a.isl / a.tsl : 0,
    ispVacS: a.tsl ? a.ivac / a.tsl : 0,
  });
  return {
    booster: toStage(acc.booster),
    ship: toStage(acc.ship, Math.max(0, carriedMassKg)),
    referenceAreaM2: Math.PI * HULL_RADIUS_M * HULL_RADIUS_M,
    dragCoefficient: STACK_DRAG_COEFFICIENT,
  };
}
