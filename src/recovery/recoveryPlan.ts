import { findPart } from '../rocket/catalog/parts';
import { HULL_RADIUS_M } from '../rocket/model/geometry';
import type { RocketBlueprint } from '../rocket/model/types';
import { instanceStages } from '../rocket/stats/calculateRocketStats';
import type { StageParams } from '../simulation/ascent/flightVehicle';

/*
 * Booster recovery planning: which recovery the booster flies, the propellant it must keep back
 * for it, and the hardware each option needs. Simplified game rules.
 */

export type RecoveryTarget = 'catch' | 'platform' | 'expend';

export const RECOVERY_LABELS: Record<RecoveryTarget, string> = {
  catch: 'Tower catch (return to launch site)',
  platform: 'Ocean platform landing (downrange)',
  expend: 'Expend the booster',
};

/** Share of booster propellant held back at staging for each recovery (game values). */
export const RESERVE_FRACTION: Record<RecoveryTarget, number> = {
  catch: 0.15,
  platform: 0.06,
  expend: 0,
};

/** Booster base altitude (m) at which the tower arms close: just above the launch mount. */
export const CATCH_HEIGHT_M = 34;
/** Capture window for a catch (game values). */
export const CATCH_WINDOW = { missM: 12, vertMS: 4, horizMS: 3, tiltDeg: 8 } as const;
/** Half-length of the ocean platform deck along the ground track. */
export const PLATFORM_HALF_DECK_M = 45;
/** Touchdown limits for a booster on legs. */
export const BOOSTER_TOUCHDOWN = { vertMS: 6, horizMS: 4, tiltDeg: 10 } as const;

export interface RecoveryHardware {
  readonly gridFins: number;
  readonly boosterLegs: number;
}

export function boosterHardware(bp: RocketBlueprint): RecoveryHardware {
  const stages = instanceStages(bp);
  const onBooster = (partId: string) =>
    bp.parts.filter((p) => p.partId === partId && stages.get(p.id) === 'booster').length;
  return { gridFins: onBooster('grid-fin'), boosterLegs: onBooster('landing-leg') };
}

/** Whether the booster can attempt a recovery option, with a player-readable reason if not. */
export function recoveryAvailability(
  target: RecoveryTarget,
  hw: RecoveryHardware,
): { ok: true } | { ok: false; reason: string } {
  if (target === 'expend') return { ok: true };
  if (hw.gridFins < 4)
    return {
      ok: false,
      reason: `Needs 4 grid fins for descent steering (${hw.gridFins} fitted). The tower catches the booster on its grid-fin hardpoints.`,
    };
  if (target === 'platform' && hw.boosterLegs < 4)
    return {
      ok: false,
      reason: `A platform landing needs 4 booster landing legs (${hw.boosterLegs} fitted).`,
    };
  return { ok: true };
}

/** Best available option: catch, then platform, then expend. */
export function defaultRecoveryTarget(hw: RecoveryHardware): RecoveryTarget {
  if (recoveryAvailability('catch', hw).ok) return 'catch';
  if (recoveryAvailability('platform', hw).ok) return 'platform';
  return 'expend';
}

/** Physical parameters of the booster on its own (after staging). */
export interface BoosterSpec {
  readonly stage: StageParams;
  readonly lengthM: number;
  readonly radiusM: number;
  readonly hardware: RecoveryHardware;
}

export function deriveBoosterSpec(bp: RocketBlueprint, stage: StageParams): BoosterSpec {
  const stages = instanceStages(bp);
  const lengthM = bp.parts
    .filter((p) => stages.get(p.id) === 'booster')
    .reduce((s, p) => s + (findPart(p.partId)?.heightM ?? 0), 0);
  return {
    stage,
    lengthM: Math.max(20, lengthM),
    radiusM: HULL_RADIUS_M,
    hardware: boosterHardware(bp),
  };
}

/**
 * A stable signature of a design's booster (or ship) part tree, used to match recovered fleet
 * hardware to designs: editing only the ship keeps the booster's signature.
 */
export function stageSignature(bp: RocketBlueprint, stage: 'booster' | 'ship'): string {
  const stages = instanceStages(bp);
  return bp.parts
    .filter((p) => stages.get(p.id) === stage)
    .map((p) => `${p.partId}@${p.parent.socketId}`)
    .sort()
    .join('|');
}
