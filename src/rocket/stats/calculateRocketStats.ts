import { findPart } from '../catalog/parts';
import type { RocketBlueprint, VehicleStage } from '../model/types';

/** Standard gravity used for the simplified liftoff thrust-to-weight ratio. */
export const STANDARD_GRAVITY_MS2 = 9.80665;

export interface StageStats {
  dryMassKg: number;
  propellantKg: number;
  thrustN: number;
  engineCount: number;
}

export interface RocketStats {
  readonly partCount: number;
  readonly dryMassKg: number;
  readonly propellantKg: number;
  readonly wetMassKg: number;
  readonly crewCapacity: number;
  readonly costCredits: number;
  readonly booster: Readonly<StageStats>;
  readonly ship: Readonly<StageStats>;
  /** Booster sea-level thrust over full-stack weight; null without booster engines. Simplified. */
  readonly liftoffTwr: number | null;
}

/** Stage of each instance: its own declared stage, else inherited from its parent. */
export function instanceStages(bp: RocketBlueprint): Map<string, VehicleStage> {
  const stages = new Map<string, VehicleStage>();
  for (const inst of bp.parts) {
    const own = findPart(inst.partId)?.stage;
    const inherited = inst.parent.parentId ? stages.get(inst.parent.parentId) : undefined;
    stages.set(inst.id, own ?? inherited ?? 'booster');
  }
  return stages;
}

export function calculateRocketStats(bp: RocketBlueprint): RocketStats {
  const empty = (): StageStats => ({ dryMassKg: 0, propellantKg: 0, thrustN: 0, engineCount: 0 });
  const byStage: Record<VehicleStage, StageStats> = { booster: empty(), ship: empty() };
  const stages = instanceStages(bp);
  let crewCapacity = 0;
  let costCredits = 0;

  for (const inst of bp.parts) {
    const part = findPart(inst.partId);
    if (!part) continue;
    const s = byStage[stages.get(inst.id) ?? 'booster'];
    s.dryMassKg += part.dryMassKg;
    s.propellantKg += part.propellantCapacityKg ?? 0;
    if (part.thrustN) {
      s.thrustN += part.thrustN;
      s.engineCount += 1;
    }
    crewCapacity += part.crewCapacity ?? 0;
    costCredits += part.costCredits;
  }

  const dryMassKg = byStage.booster.dryMassKg + byStage.ship.dryMassKg;
  const propellantKg = byStage.booster.propellantKg + byStage.ship.propellantKg;
  const wetMassKg = dryMassKg + propellantKg;
  const liftoffTwr =
    byStage.booster.thrustN > 0 && wetMassKg > 0
      ? byStage.booster.thrustN / (wetMassKg * STANDARD_GRAVITY_MS2)
      : null;

  return {
    partCount: bp.parts.length,
    dryMassKg,
    propellantKg,
    wetMassKg,
    crewCapacity,
    costCredits,
    booster: byStage.booster,
    ship: byStage.ship,
    liftoffTwr,
  };
}
