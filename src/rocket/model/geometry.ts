/** Shared vehicle dimensions (game scale: roughly 70% of a real heavy-lift vehicle's height). */

export const HULL_RADIUS_M = 4.5;
export const ENGINE_BELL_LENGTH_M = 3.2;
export const ENGINE_BELL_RADIUS_M = 0.85;

/** Nose cone profile: an elliptical dome from full hull radius at y=0 down to the tip at y=height. */
export function noseRadiusAt(y: number, heightM: number): number {
  const t = Math.min(Math.max(y / heightM, 0), 1);
  return HULL_RADIUS_M * Math.sqrt(1 - t * t);
}
