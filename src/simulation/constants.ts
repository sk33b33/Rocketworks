/*
 * Physical constants and gameplay approximations for flight simulation. SI units throughout.
 * The model is deliberately simplified (2D, spherical Earth, exponential atmosphere) and is
 * not a substitute for a real trajectory simulator.
 */

export const G0_MS2 = 9.80665;
export const EARTH_RADIUS_M = 6_371_000;
export const EARTH_MU_M3S2 = 3.986004418e14;
export const SEA_LEVEL_DENSITY_KGM3 = 1.225;
/** Exponential atmosphere scale height (gameplay value). */
export const SCALE_HEIGHT_M = 8_500;

/** Fixed simulation step. Rendering interpolates nothing; it simply shows the latest state. */
export const SIM_DT_S = 0.05;
/** Cap on simulation steps per frame (protects against huge catch-ups). */
export const MAX_STEPS_PER_FRAME = 400;

export function airDensity(altitudeM: number): number {
  return altitudeM < 0
    ? SEA_LEVEL_DENSITY_KGM3
    : SEA_LEVEL_DENSITY_KGM3 * Math.exp(-altitudeM / SCALE_HEIGHT_M);
}

/** Ambient pressure as a fraction of sea level (0..1). */
export function pressureRatio(altitudeM: number): number {
  return altitudeM < 0 ? 1 : Math.exp(-altitudeM / SCALE_HEIGHT_M);
}

/** Circular orbital speed at an altitude. */
export function circularSpeed(altitudeM: number): number {
  return Math.sqrt(EARTH_MU_M3S2 / (EARTH_RADIUS_M + altitudeM));
}
