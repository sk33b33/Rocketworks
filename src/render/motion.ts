/*
 * Shared "reduce motion" preference for the 3D scenes (set from the player's settings): no
 * automatic camera orbits, no strobing lights, no flicker or jitter. Framework-free.
 */
let reduced = false;

export function setReducedMotion(on: boolean): void {
  reduced = on;
}

export function motionReduced(): boolean {
  return reduced;
}

/** Scales an automatic animation term: 0 when motion is reduced. */
export function autoMotion(value: number): number {
  return reduced ? 0 : value;
}
