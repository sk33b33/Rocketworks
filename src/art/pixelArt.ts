import type { LocationId } from '../app/locations';
import { findMission } from '../missions/missionCatalog';
import { CREW_ROSTER } from '../missions/crew';

/*
 * The game's pixel art: original sprites written as code in art/rocketworks.px.js and built with
 * pxl (`npm run art`) into public/art/sprites/. This module only maps game things to those files,
 * so the interface and the scenes agree on names. Pure apart from the base URL.
 */

/** Where the built sprites are served from, below the app's base URL. */
export const PIXEL_ART_DIR = 'art/sprites/';

/** URL of a built sprite. */
export function artUrl(name: string): string {
  return `${import.meta.env.BASE_URL}${PIXEL_ART_DIR}${name}.png`;
}

/** Native sprite sizes (px), for crisp whole-number scaling in the interface. */
export const ART_SIZE = {
  logo: [7, 8],
  icon: [8, 8],
  patch: [23, 23],
  portrait: [16, 16],
} as const;

export const LOCATION_ICONS: Record<LocationId, string> = {
  factory: 'loc_factory',
  'mission-control': 'loc_mission_control',
  'launch-pad': 'loc_launch_pad',
  flight: 'loc_flight',
  station: 'loc_station',
  moon: 'loc_moon',
  mars: 'loc_mars',
};

/** Story missions with a patch of their own (contract flights use their kind's patch). */
export const STORY_PATCHES = [
  'test-flight',
  'orbital-flight',
  'station-docking',
  'lunar-transfer',
  'lunar-landing',
  'mars-cargo',
  'mars-crewed',
] as const;

/** The mission patch sprite for a mission, or null if it has none. */
export function patchFor(missionId: string): string | null {
  const def = findMission(missionId);
  if (!def) return null;
  if (def.contract) return `patch_${def.contract}`;
  return (STORY_PATCHES as readonly string[]).includes(missionId) ? `patch_${missionId}` : null;
}

/** The portrait sprite for a crew member, or null for an unknown id. */
export function portraitFor(crewId: string): string | null {
  return CREW_ROSTER.some((c) => c.id === crewId) ? `crew_${crewId}` : null;
}

/** Signage on the assembly hall's left wall: sprite, size and placement (metres). */
export interface WallSign {
  readonly sprite: string;
  readonly widthM: number;
  readonly heightM: number;
  /** Centre along the wall (z) and height (y). */
  readonly z: number;
  readonly y: number;
  /** Distance in front of the wall: clear of the girts (0.9 m) or the columns (2.75 m). */
  readonly offsetM: number;
}

/**
 * Wall columns stand every 20 m (z = -120, -100, ...) and girts every 18 m up (y = 15, 33, 51):
 * posters hang between the columns, in front of the girts; the wide bay sign is mounted on the
 * column faces.
 */
export const FACTORY_SIGNS: readonly WallSign[] = [
  { sprite: 'sign_bay', widthM: 48, heightM: 12, z: -30, y: 46, offsetM: 2.9 },
  { sprite: 'poster_safety', widthM: 15, heightM: 21, z: -70, y: 26, offsetM: 1.0 },
  { sprite: 'poster_moon', widthM: 15, heightM: 21, z: -30, y: 26, offsetM: 1.0 },
  { sprite: 'poster_mars', widthM: 15, heightM: 21, z: 10, y: 26, offsetM: 1.0 },
  { sprite: 'banner_rocketworks', widthM: 7.2, heightM: 45, z: -90, y: 34, offsetM: 1.1 },
];
