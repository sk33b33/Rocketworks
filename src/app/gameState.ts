import { getAvailability, type LocationId } from './locations';

export type NavigationResult =
  { ok: true; location: LocationId } | { ok: false; location: LocationId; reason: string };

/** Pure navigation rule: locked locations are rejected with a player-readable reason. */
export function navigate(current: LocationId, target: LocationId): NavigationResult {
  const availability = getAvailability(target);
  if (!availability.available) return { ok: false, location: current, reason: availability.reason };
  return { ok: true, location: target };
}
