/** Location registry: pure data + pure availability logic (no Three.js, no DOM). */

export type LocationId =
  'factory' | 'mission-control' | 'launch-pad' | 'flight' | 'station' | 'moon';

export interface LocationDefinition {
  readonly id: LocationId;
  readonly name: string;
  /** Roadmap stage in which this location becomes playable. */
  readonly implementedInStage: number;
  readonly lockedReason: string;
}

export const LOCATIONS: readonly LocationDefinition[] = [
  { id: 'factory', name: 'Rocket Factory', implementedInStage: 0, lockedReason: '' },
  {
    id: 'mission-control',
    name: 'Mission Control',
    implementedInStage: 3,
    lockedReason:
      'Unlocks in a later stage (Mission Control). Certify a design in the Readiness tab to be ready for it.',
  },
  {
    id: 'launch-pad',
    name: 'Launch Pad',
    implementedInStage: 4,
    lockedReason: 'Unlocks in a later stage (Launch Pad). Requires a mission from Mission Control.',
  },
  {
    id: 'flight',
    name: 'Flight / Orbit',
    implementedInStage: 5,
    lockedReason: 'Unlocks in a later stage (Flight). Requires a successful launch.',
  },
  {
    id: 'station',
    name: 'Orbital Station',
    implementedInStage: 7,
    lockedReason: 'Unlocks in a later stage (Orbital Station). Requires reaching orbit.',
  },
  {
    id: 'moon',
    name: 'Moon',
    implementedInStage: 8,
    lockedReason: 'Unlocks in a later stage (Moon). Requires an orbital-capable vehicle.',
  },
];

/** Highest roadmap stage implemented by this build. Bump as stages are accepted. */
export const CURRENT_STAGE = 1;

export const DEFAULT_LOCATION: LocationId = 'factory';

export function getLocation(id: LocationId): LocationDefinition {
  const def = LOCATIONS.find((l) => l.id === id);
  if (!def) throw new Error(`Unknown location: ${id}`);
  return def;
}

export function isLocationId(value: unknown): value is LocationId {
  return typeof value === 'string' && LOCATIONS.some((l) => l.id === value);
}

export type Availability = { available: true } | { available: false; reason: string };

export function getAvailability(id: LocationId, stage: number = CURRENT_STAGE): Availability {
  const def = getLocation(id);
  return def.implementedInStage <= stage
    ? { available: true }
    : { available: false, reason: def.lockedReason };
}
