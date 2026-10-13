import { findPart } from '../catalog/parts';
import type { RocketBlueprint } from '../model/types';
import { instanceStages, STANDARD_GRAVITY_MS2 } from '../stats/calculateRocketStats';

/*
 * Simplified two-stage Δv estimate using the ideal rocket equation per stage. Ignores gravity and
 * drag losses (they are folded into the gameplay orbit threshold below). Game approximation only.
 */

/** Gameplay Δv needed to reach low orbit from the pad, losses included. Not a physical constant. */
export const ORBIT_DELTA_V_MS = 9_200;
/** Extra reserve required for crewed flights (deorbit and landing margin). Game value. */
export const CREW_RESERVE_DELTA_V_MS = 400;

export interface StageDeltaV {
  readonly deltaVMs: number;
  /** Thrust-weighted effective specific impulse used for this stage, seconds. */
  readonly ispS: number;
  readonly initialMassKg: number;
  readonly finalMassKg: number;
}

export interface DeltaVEstimate {
  readonly booster: StageDeltaV;
  readonly ship: StageDeltaV;
  readonly totalMs: number;
}

function stageDeltaV(ispS: number, m0: number, mf: number): number {
  if (ispS <= 0 || mf <= 0 || m0 <= mf) return 0;
  return STANDARD_GRAVITY_MS2 * ispS * Math.log(m0 / mf);
}

/**
 * @param extraShipMassKg mass carried by the ship that is not part of the design (payload, crew,
 *   consumables). It is never burned, so it adds to the ship's initial and final mass.
 */
export function estimateDeltaV(
  bp: RocketBlueprint,
  extraShipMassKg = 0,
  /** Share of booster propellant held back for recovery (not available for the ascent). */
  boosterReserveFraction = 0,
): DeltaVEstimate {
  const stages = instanceStages(bp);
  const acc = {
    booster: { dry: 0, prop: 0, thrust: 0, ispThrust: 0 },
    ship: { dry: 0, prop: 0, thrust: 0, ispThrust: 0 },
  };
  for (const inst of bp.parts) {
    const part = findPart(inst.partId);
    if (!part) continue;
    const stage = stages.get(inst.id) ?? 'booster';
    const a = acc[stage];
    a.dry += part.dryMassKg;
    a.prop += part.propellantCapacityKg ?? 0;
    if (part.thrustN) {
      const sl = part.ispSeaLevelS ?? 300;
      const vac = part.ispVacuumS ?? sl;
      // Booster burns mostly in the atmosphere: average of sea-level and vacuum Isp.
      const isp = stage === 'booster' ? (sl + vac) / 2 : vac;
      a.thrust += part.thrustN;
      a.ispThrust += isp * part.thrustN;
    }
  }
  acc.ship.dry += Math.max(0, extraShipMassKg);
  const reserve = acc.booster.prop * Math.min(1, Math.max(0, boosterReserveFraction));
  acc.booster.dry += reserve;
  acc.booster.prop -= reserve;
  const shipWet = acc.ship.dry + acc.ship.prop;
  const totalWet = acc.booster.dry + acc.booster.prop + shipWet;
  const boosterIsp = acc.booster.thrust ? acc.booster.ispThrust / acc.booster.thrust : 0;
  const shipIsp = acc.ship.thrust ? acc.ship.ispThrust / acc.ship.thrust : 0;

  const booster: StageDeltaV = {
    ispS: boosterIsp,
    initialMassKg: totalWet,
    finalMassKg: totalWet - acc.booster.prop,
    deltaVMs: stageDeltaV(boosterIsp, totalWet, totalWet - acc.booster.prop),
  };
  const ship: StageDeltaV = {
    ispS: shipIsp,
    initialMassKg: shipWet,
    finalMassKg: acc.ship.dry,
    deltaVMs: stageDeltaV(shipIsp, shipWet, acc.ship.dry),
  };
  return { booster, ship, totalMs: booster.deltaVMs + ship.deltaVMs };
}
