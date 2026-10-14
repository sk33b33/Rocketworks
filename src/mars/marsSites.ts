import { SiteTerrain, type HazardLevel } from '../moon/lunarSites';
import { MARS_RADIUS_M } from './solarSystem';

/*
 * Fictional Mars landing sites. What sets them apart is what matters for a Mars landing in this
 * game: elevation (low ground leaves more air to slow down in; high ground less), terrain hazards
 * near the target, and water ice for the propellant plant. Terrain uses the same deterministic
 * generator as the Moon, around the site's elevation. Game values, not real geography.
 *
 * Mars's rotation isn't simulated. Instead, the arrival is timed so the chosen site lies on the
 * ground track ahead of the entry point (the site's position is fixed when the final approach
 * correction is made) — standing in for choosing the arrival time as Mars turns.
 */

export interface MarsSite {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Elevation of the site's surroundings above the datum (m). */
  readonly elevationM: number;
  readonly hazard: HazardLevel;
  readonly roughness: number;
  readonly boulderDensity: number;
  /** 0..1 accessible water ice: scales the propellant plant's output. */
  readonly ice: number;
  readonly science: string;
  readonly seed: number;
  /** Unused for Mars (the terrain generator's angle field). */
  readonly seleno: 0;
}

export const MARS_SITES: readonly MarsSite[] = [
  {
    id: 'boreal-flats',
    name: 'Boreal Flats',
    description:
      'A smooth northern lowland 4 km below the datum: the thickest air on Mars to slow down in, and ice just under the dust.',
    elevationM: -4_000,
    hazard: 'low',
    roughness: 0.2,
    boulderDensity: 0.004,
    ice: 1,
    science: 'Shallow ground ice: ideal for the propellant plant.',
    seed: 71,
    seleno: 0,
  },
  {
    id: 'delta-hollow',
    name: 'Delta Hollow',
    description:
      'An ancient river delta in a crater basin. Layered sediments, some channels and boulders.',
    elevationM: -2_500,
    hazard: 'moderate',
    roughness: 0.5,
    boulderDensity: 0.012,
    ice: 0.6,
    science: 'Layered lake sediments: rich science, some buried ice.',
    seed: 83,
    seleno: 0,
  },
  {
    id: 'redstone-plateau',
    name: 'Redstone Plateau',
    description:
      'A volcanic plateau 3 km above the datum. Firm ground, but thin air: the ship falls faster and needs a longer landing burn.',
    elevationM: 3_000,
    hazard: 'moderate',
    roughness: 0.45,
    boulderDensity: 0.01,
    ice: 0.25,
    science: 'Young lava flows; little ice nearby.',
    seed: 97,
    seleno: 0,
  },
  {
    id: 'chasm-rim',
    name: 'Chasm Rim',
    description:
      'The edge of a great canyon: kilometres of exposed rock layers, but rough, blocky ground.',
    elevationM: 1_000,
    hazard: 'high',
    roughness: 0.85,
    boulderDensity: 0.028,
    ice: 0.35,
    science: 'Exposed canyon walls: the best geology on offer.',
    seed: 109,
    seleno: 0,
  },
];

export const DEFAULT_MARS_SITE_ID = 'boreal-flats';

export function findMarsSite(id: string | null | undefined): MarsSite | undefined {
  return MARS_SITES.find((s) => s.id === id);
}

/** Terrain around a Mars site (heights relative to the site's elevation). */
export function marsTerrain(site: MarsSite): SiteTerrain<MarsSite> {
  return new SiteTerrain(site, MARS_RADIUS_M);
}
