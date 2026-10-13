import { EARTH_RADIUS_M } from '../simulation/constants';
import { wrapAngle } from './orbitMath';

/*
 * Landing zones on the (planar) ground track. Geography is simplified: the launch coast is land,
 * everything else under the track is open ocean.
 */

export type ZoneKind = 'pad' | 'platform' | 'splash';

export interface LandingZone {
  readonly id: string;
  readonly name: string;
  readonly kind: ZoneKind;
  /** Ground angle from the launch site, radians (eastward positive). */
  readonly groundAngle: number;
  /** Miss distance that still counts as "on target". */
  readonly toleranceM: number;
  readonly description: string;
}

export const LANDING_ZONES: readonly LandingZone[] = [
  {
    id: 'splash',
    name: 'Equatorial splashdown zone',
    kind: 'splash',
    groundAngle: -0.9,
    toleranceM: 40_000,
    description: 'Wide ocean target. Forgiving, but the ship is not recovered.',
  },
  {
    id: 'platform',
    name: 'Ocean platform "Kestrel"',
    kind: 'platform',
    groundAngle: -0.45,
    toleranceM: 1_500,
    description: 'Floating landing deck. Needs a precise deorbit and landing burn.',
  },
  {
    id: 'rtls',
    name: 'Launch site landing pad',
    kind: 'pad',
    groundAngle: 0.004,
    toleranceM: 1_500,
    description: 'Return to the launch site after one orbit. The hardest target.',
  },
];

export function findZone(id: string): LandingZone | undefined {
  return LANDING_ZONES.find((z) => z.id === id);
}

/** Half-width of the launch coast (land) around the launch site, radians. */
export const COAST_HALF_WIDTH_RAD = 0.05;

export function isLand(groundAngle: number): boolean {
  return Math.abs(wrapAngle(groundAngle)) <= COAST_HALF_WIDTH_RAD;
}

/** Signed along-track miss (m): positive = landed past the zone (overshoot). */
export function missDistanceM(groundAngle: number, zone: LandingZone): number {
  return wrapAngle(groundAngle - zone.groundAngle) * EARTH_RADIUS_M;
}

/** The zone (preferring `preferred`) whose tolerance contains this ground angle, if any. */
export function findZoneAt(groundAngle: number, preferred?: LandingZone): LandingZone | undefined {
  const inside = (z: LandingZone) => Math.abs(missDistanceM(groundAngle, z)) <= z.toleranceM;
  if (preferred && inside(preferred)) return preferred;
  return LANDING_ZONES.find(inside);
}
