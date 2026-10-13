import type { MissionDefinition } from '../missions/missionCatalog';
import type { AscentTarget } from '../simulation/ascent/ascentModel';

/** Gameplay parking orbit used by every orbital mission's ascent. */
export const PARKING_ORBIT_ALTITUDE_M = 150_000;

/** The ascent target that a mission's launch flies to. */
export function ascentTargetFor(mission: MissionDefinition): AscentTarget {
  return mission.destination === 'suborbital'
    ? { kind: 'suborbital', secoSpeedMS: 5_600, minApogeeM: 100_000 }
    : { kind: 'orbit', altitudeM: PARKING_ORBIT_ALTITUDE_M };
}
