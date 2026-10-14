import type { OrbitBody, Vec2 } from '../flight/orbitMath';
import { wrapAngle } from '../flight/orbitMath';

/*
 * The inner solar system in the game's single orbital plane: Earth and Mars on circular orbits
 * around the Sun, moving eastward (clockwise, angles increasing in the atan2(x, y) convention like
 * everything else). Heliocentric axes are parallel to the Earth-centred flight frame, so a ship's
 * heliocentric state is Earth's plus its Earth-centred one. Simplified gameplay model: real orbits
 * are eccentric and inclined, so real launch windows differ from one opportunity to the next.
 *
 * Time is "program time": seconds since the program's day 0 (the calendar in Mission Control).
 * A flight's own clock (tS, from liftoff) adds to its launch day's start.
 */

export const DAY_S = 86_400;
export const SUN_MU_M3S2 = 1.32712440018e20;
export const AU_M = 1.495978707e11;

export const MARS_MU_M3S2 = 4.282837e13;
export const MARS_RADIUS_M = 3_389_500;
/** Mars's sphere of influence (patched-conic boundary). */
export const MARS_SOI_M = 5.77e8;
/** Earth's sphere of influence about the Sun. */
export const EARTH_SOI_M = 9.25e8;

export const MARS_BODY: OrbitBody = {
  mu: MARS_MU_M3S2,
  radiusM: MARS_RADIUS_M,
  stablePeriapsisM: 100_000,
};

export type Planet = 'earth' | 'mars';

export interface PlanetOrbit {
  readonly radiusM: number;
  /** Mean motion (rad/s). */
  readonly n: number;
  /** Heliocentric angle at program time 0. */
  readonly angle0: number;
}

const orbit = (radiusM: number, angle0: number): PlanetOrbit => ({
  radiusM,
  n: Math.sqrt(SUN_MU_M3S2 / radiusM ** 3),
  angle0,
});

const EARTH_R = AU_M;
const MARS_R = 1.523679 * AU_M;
const EARTH_N = Math.sqrt(SUN_MU_M3S2 / EARTH_R ** 3);
const MARS_N = Math.sqrt(SUN_MU_M3S2 / MARS_R ** 3);

/** Synodic period: Earth–Mars geometry (and so every launch window) repeats this often. */
export const SYNODIC_S = (2 * Math.PI) / (EARTH_N - MARS_N);

/** Phase (Mars ahead of Earth, rad) for a minimum-energy (Hohmann) transfer. */
export const HOHMANN_TOF_S = Math.PI * Math.sqrt(((EARTH_R + MARS_R) / 2) ** 3 / SUN_MU_M3S2);
export const HOHMANN_PHASE_RAD = Math.PI - MARS_N * HOHMANN_TOF_S;

/** Program day of the first Hohmann departure opportunity (a game value). */
export const FIRST_WINDOW_DAY = 240;

export const PLANETS: Record<Planet, PlanetOrbit> = {
  earth: orbit(EARTH_R, 0),
  // Mars is placed so that the Hohmann phase occurs on FIRST_WINDOW_DAY.
  mars: orbit(MARS_R, HOHMANN_PHASE_RAD + (EARTH_N - MARS_N) * FIRST_WINDOW_DAY * DAY_S),
};

export interface PlanetState {
  readonly angle: number;
  readonly r: Vec2;
  readonly v: Vec2;
}

/** Heliocentric position and velocity of a planet at program time T (s). */
export function planetState(planet: Planet, T: number): PlanetState {
  const o = PLANETS[planet];
  const angle = wrapAngle(o.angle0 + o.n * T);
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const speed = o.n * o.radiusM;
  return { angle, r: [s * o.radiusM, c * o.radiusM], v: [c * speed, -s * speed] };
}

/** Mars-minus-Earth phase angle at program time T (rad, wrapped). */
export function marsPhase(T: number): number {
  return wrapAngle(planetState('mars', T).angle - planetState('earth', T).angle);
}

/** Program time (s) for a flight's clock reading: launch day start plus time since liftoff. */
export function programTime(launchDay: number, tS: number): number {
  return launchDay * DAY_S + tS;
}

// ---- Mars atmosphere (exponential gameplay model) ----

/** Density at the datum (the reference "zero" elevation), kg/m³. */
export const MARS_DATUM_DENSITY = 0.02;
export const MARS_SCALE_HEIGHT_M = 11_100;
/** Datum pressure as a fraction of Earth sea level (≈ 0.6 kPa). */
export const MARS_DATUM_PRESSURE = 0.006;
/** Entry interface: the atmosphere is ignored above this altitude. */
export const MARS_INTERFACE_M = 125_000;
export const MARS_SURFACE_G = MARS_MU_M3S2 / MARS_RADIUS_M ** 2;

export function marsDensity(altitudeM: number): number {
  return altitudeM > MARS_INTERFACE_M
    ? 0
    : MARS_DATUM_DENSITY * Math.exp(-altitudeM / MARS_SCALE_HEIGHT_M);
}

export function marsPressureRatio(altitudeM: number): number {
  return altitudeM > MARS_INTERFACE_M
    ? 0
    : MARS_DATUM_PRESSURE * Math.exp(-altitudeM / MARS_SCALE_HEIGHT_M);
}
