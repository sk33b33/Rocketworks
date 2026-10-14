import type { ShipSpec } from '../../flight/flightModel';
import { checkMarsReturnLegs, type MarsReturnLegs } from '../../mars/marsRules';
import type { MarsView } from '../../mars/marsFlight';
import { G0_MS2 } from '../../simulation/constants';

/** Δv the ship has with `propKg` in its tanks (m/s). */
export function shipDeltaV(spec: ShipSpec, propKg: number): number {
  const dry = spec.stage.dryMassKg;
  return propKg > 0 ? spec.stage.ispVacS * G0_MS2 * Math.log((dry + propKg) / dry) : 0;
}

/** The legs home from the surface with the propellant on board now. */
export function returnLegsNow(mars: MarsView, spec: ShipSpec, propKg: number): MarsReturnLegs {
  const w = mars.returnWindow;
  const tei = w?.today?.tmiDvMS ?? w?.bestDvMS ?? 2_200;
  return checkMarsReturnLegs(tei, propKg, spec.stage.dryMassKg, spec.stage.ispVacS);
}
