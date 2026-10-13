import { mulberry32 } from '../../shared/random';
import type { ScheduledFailure } from './ascentModel';

/*
 * Risk-driven random failures, drawn once per flight from a seed so a flight is reproducible.
 * Probabilities are gameplay values scaled by the mission risk score (0..1).
 */

export const FAILURE_WEIGHTS = {
  boosterEngineOut: 0.5,
  shipEngineOut: 0.3,
  vehicleLoss: 0.12,
} as const;

export function planFailures(seed: number, risk: number, enabled: boolean): ScheduledFailure[] {
  if (!enabled) return [];
  const r = Math.min(0.95, Math.max(0, risk));
  const rng = mulberry32(seed);
  const out: ScheduledFailure[] = [];
  if (rng() < r * FAILURE_WEIGHTS.boosterEngineOut)
    out.push({ atS: 20 + rng() * 100, kind: 'booster-engine-out' });
  if (rng() < r * FAILURE_WEIGHTS.shipEngineOut)
    out.push({ atS: 150 + rng() * 120, kind: 'ship-engine-out' });
  if (rng() < r * FAILURE_WEIGHTS.vehicleLoss)
    out.push({ atS: 30 + rng() * 240, kind: 'vehicle-loss' });
  return out.sort((a, b) => a.atS - b.atS);
}
