import { FLYBY_RULES, LANDING_RULES, type LunarMissionRules } from '../moon/lunarRules';
import { MARS_SUPPLIES_KG, PLANT_CARGO_KG } from '../mars/marsRules';

/*
 * Mission and payload catalog. Destinations are fictionalized; Δv requirements, durations and
 * rewards are game values chosen for progression, not mission-design data.
 */

export type Destination =
  'suborbital' | 'leo' | 'station' | 'lunar-orbit' | 'lunar-surface' | 'mars-surface';

export type MissionUnlock =
  | { readonly kind: 'start' }
  | { readonly kind: 'after'; readonly missionIds: readonly string[] }
  | { readonly kind: 'later-stage'; readonly reason: string };

export interface MissionRequirements {
  /** Crew range; 0/0 means uncrewed. */
  readonly minCrew: number;
  readonly maxCrew: number;
  readonly dockingAdapter: boolean;
  /** RCS needed for attitude control: 'critical' blocks, 'warning' only advises. */
  readonly rcs: 'none' | 'warning' | 'critical';
  readonly antenna: 'warning' | 'critical';
  /** Ship must be fully tiled and flapped for re-entry. */
  readonly reentry: boolean;
}

export interface MissionDefinition {
  readonly id: string;
  readonly name: string;
  readonly destination: Destination;
  readonly destinationLabel: string;
  readonly summary: string;
  readonly briefing: string;
  readonly objectives: readonly string[];
  readonly abortCriteria: readonly string[];
  readonly durationDays: number;
  /** Gameplay Δv requirement from the pad, losses included. */
  readonly requiredDeltaVMs: number;
  readonly requirements: MissionRequirements;
  readonly payloadIds: readonly string[];
  /** 0..1 inherent difficulty contribution to mission risk. */
  readonly baseRisk: number;
  readonly rewardRp: number;
  readonly rewardCredits: number;
  readonly unlock: MissionUnlock;
  /** Moon missions: the goal and the Δv legs flown after reaching orbit. */
  readonly lunar?: LunarMissionRules;
  /** Mars missions: flown in launch windows; the cargo that sets up the propellant plant. */
  readonly mars?: {
    /** The payload a cargo flight carries (selected by default). */
    readonly plantPayloadId?: string;
    /** Crewed round trip: lands at the plant, refuels there and flies home. */
    readonly crewed?: boolean;
    /** The payload a crewed trip carries (selected by default). */
    readonly suppliesPayloadId?: string;
  };
}

export interface PayloadDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly massKg: number;
  /** Needs a Cargo Bay Module; otherwise it rides in the ship structure or cabin. */
  readonly requiresBay: boolean;
  /** Crew-days of life support it adds (consumables and recycling kit). */
  readonly lifeSupportCrewDays?: number;
}

export const PAYLOADS: readonly PayloadDefinition[] = [
  { id: 'none', name: 'No payload', description: 'Fly light.', massKg: 0, requiresBay: false },
  {
    id: 'test-ballast',
    name: 'Mass simulator',
    description: 'Water ballast that simulates a payload for structural testing.',
    massKg: 10_000,
    requiresBay: false,
  },
  {
    id: 'science-pod',
    name: 'Microgravity science pod',
    description: 'Compact experiment rack that rides in the cabin.',
    massKg: 4_000,
    requiresBay: false,
  },
  {
    id: 'comms-sat',
    name: 'Relay communications satellite',
    description: 'A fictional relay satellite deployed from the cargo bay.',
    massKg: 12_000,
    requiresBay: true,
  },
  {
    id: 'station-supplies',
    name: 'Station resupply module',
    description: 'Food, water, spares and experiments for the orbital station.',
    massKg: 15_000,
    requiresBay: true,
  },
  {
    id: 'lunar-relay',
    name: 'Lunar relay satellite',
    description: 'Comms relay for future far-side operations.',
    massKg: 8_000,
    requiresBay: true,
  },
  {
    id: 'surface-science',
    name: 'Surface science package',
    description: 'Seismometer, heat-flow probe and a sample return kit, unloaded on the Moon.',
    massKg: 6_000,
    requiresBay: true,
  },
  {
    id: 'mars-plant',
    name: 'Propellant plant',
    description:
      'Solar arrays, an ice drill and a fuel-making plant, lowered to the Martian surface from the cargo bay.',
    massKg: PLANT_CARGO_KG,
    requiresBay: true,
  },
  {
    id: 'mars-supplies',
    name: 'Mars expedition supplies',
    description:
      'Food, a closed-loop water and air recycling kit and EVA spares for a crew of up to four on a two-and-a-half-year trip.',
    massKg: MARS_SUPPLIES_KG,
    requiresBay: false,
    lifeSupportCrewDays: 4_000,
  },
];

export const MISSIONS: readonly MissionDefinition[] = [
  {
    id: 'test-flight',
    name: 'Uncrewed Test Flight',
    destination: 'suborbital',
    destinationLabel: 'Suborbital hop',
    summary: 'Prove the stack: liftoff, hot staging and a controlled ship re-entry.',
    briefing:
      'The first full-stack flight carries no crew. Engineering wants clean ascent data, a hot-staging event and telemetry from the ship through re-entry. Booster recovery is a bonus, not a requirement.',
    objectives: [
      'Clear the tower and fly through max-Q',
      'Hot-stage the ship from the booster',
      'Reach the planned suborbital apogee',
      'Return telemetry through re-entry',
    ],
    abortCriteria: [
      'Loss of more than 3 booster engines before staging',
      'Vehicle leaves the range safety corridor',
      'Loss of telemetry for more than 30 s',
    ],
    durationDays: 0.1,
    requiredDeltaVMs: 6_500,
    requirements: {
      minCrew: 0,
      maxCrew: 0,
      dockingAdapter: false,
      rcs: 'none',
      antenna: 'warning',
      reentry: false,
    },
    payloadIds: ['none', 'test-ballast'],
    baseRisk: 0.2,
    rewardRp: 2,
    rewardCredits: 20_000,
    unlock: { kind: 'start' },
  },
  {
    id: 'orbital-flight',
    name: 'Crewed Orbital Shakedown',
    destination: 'leo',
    destinationLabel: 'Low orbit',
    summary: 'Fly a crew to low orbit for three days and bring them home.',
    briefing:
      'The first crewed flight. The crew will check out life support, manual attitude control and communications over several orbits before a precision re-entry. Crew safety outranks every other objective.',
    objectives: [
      'Insert into a stable low orbit',
      'Complete life-support and manual-control checkouts',
      'Deploy the optional payload',
      'Re-enter and land with the crew safe',
    ],
    abortCriteria: [
      'Cabin pressure below safe limits',
      'Loss of two or more ship engines during ascent',
      'Heat-shield damage reported before deorbit',
    ],
    durationDays: 3,
    requiredDeltaVMs: 9_750,
    requirements: {
      minCrew: 2,
      maxCrew: 8,
      dockingAdapter: false,
      rcs: 'warning',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['none', 'science-pod', 'comms-sat'],
    baseRisk: 0.3,
    rewardRp: 3,
    rewardCredits: 30_000,
    unlock: { kind: 'start' },
  },
  {
    id: 'station-docking',
    name: 'Station Crew Rotation',
    destination: 'station',
    destinationLabel: 'Orbital station',
    summary: 'Rendezvous and dock with the fictional orbital station; swap crews and resupply.',
    briefing:
      'Deliver a fresh crew and supplies to the station. The approach is flown under a strict keep-out corridor; RCS and a docking adapter are mandatory.',
    objectives: [
      'Launch into the station’s orbital plane',
      'Rendezvous and enter the approach corridor',
      'Dock, transfer crew and cargo',
      'Undock and return',
    ],
    abortCriteria: [
      'Closing speed above corridor limits inside 200 m',
      'Docking alignment error above tolerance at contact',
      'Station declares an emergency',
    ],
    durationDays: 6,
    requiredDeltaVMs: 9_900,
    requirements: {
      minCrew: 2,
      maxCrew: 8,
      dockingAdapter: true,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['none', 'science-pod', 'station-supplies'],
    baseRisk: 0.4,
    rewardRp: 4,
    rewardCredits: 40_000,
    unlock: { kind: 'after', missionIds: ['orbital-flight'] },
  },
  {
    id: 'lunar-transfer',
    name: 'Lunar Flyby',
    destination: 'lunar-orbit',
    destinationLabel: 'Lunar flyby',
    summary: 'Send a crew around the Moon and back on a free-return trajectory.',
    briefing:
      'Our first deep-space flight. Tankers fill the ship in low Earth orbit, then trans-lunar injection sends it past the Moon on a free return. The way home ends with an aerocapture pass through the upper atmosphere at nearly 11 km/s before a normal deorbit and landing.',
    objectives: [
      'Refuel in low Earth orbit',
      'Trans-lunar injection',
      'Lunar flyby photography',
      'Aerocapture and return to orbit',
      'Re-entry and landing',
    ],
    abortCriteria: ['Trans-lunar injection under-burn', 'Life-support margin below 20%'],
    durationDays: 9,
    requiredDeltaVMs: 9_750,
    requirements: {
      minCrew: 2,
      maxCrew: 6,
      dockingAdapter: false,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['none', 'science-pod', 'lunar-relay'],
    baseRisk: 0.55,
    rewardRp: 5,
    rewardCredits: 60_000,
    unlock: { kind: 'after', missionIds: ['station-docking'] },
    lunar: FLYBY_RULES,
  },
  {
    id: 'lunar-landing',
    name: 'Lunar Landing',
    destination: 'lunar-surface',
    destinationLabel: 'Lunar surface',
    summary: 'Land a crew on the Moon, work on the surface and bring them home.',
    briefing:
      'Refuel in low Earth orbit, fly to lunar orbit and top up at the depot. Then pick a landing site, descend under guidance (take over for the final few hundred metres if you like), run the surface tasks, lift off and fly home. Steep or boulder-strewn ground can tip the ship over.',
    objectives: [
      'Refuel in Earth orbit and at the lunar depot',
      'Land at the selected site',
      'Surface operations',
      'Ascent to lunar orbit and the trip home',
    ],
    abortCriteria: ['Landing site hazards exceed limits', 'Propellant below the ascent reserve'],
    durationDays: 12,
    requiredDeltaVMs: 9_750,
    requirements: {
      minCrew: 2,
      maxCrew: 4,
      dockingAdapter: true,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['none', 'surface-science'],
    baseRisk: 0.7,
    rewardRp: 8,
    rewardCredits: 100_000,
    unlock: { kind: 'after', missionIds: ['lunar-transfer'] },
    lunar: LANDING_RULES,
  },
  {
    id: 'mars-cargo',
    name: 'Mars Cargo Lander',
    destination: 'mars-surface',
    destinationLabel: 'Mars surface',
    summary: 'Send an uncrewed ship to Mars with a propellant plant for future crews.',
    briefing:
      'Launch inside an Earth–Mars window (they open about every 26 months), fill the tanks in low Earth orbit and inject toward Mars. Cruise navigation corrects the course on the way. At Mars the ship enters the thin atmosphere belly-first, flips and lands on its engines at the site you choose, then lowers the propellant plant to the ground. The ship stays on Mars as its tanker.',
    objectives: [
      'Refuel in Earth orbit and inject toward Mars inside the window',
      'Cruise to Mars',
      'Enter the atmosphere and land at the selected site',
      'Unload and start the propellant plant',
    ],
    abortCriteria: ['Injection outside the launch window', 'Heat shield below entry limits'],
    durationDays: 280,
    // Just orbit (with a small reserve): refuelling fills the tanks for the legs after it.
    requiredDeltaVMs: 9_300,
    requirements: {
      minCrew: 0,
      maxCrew: 0,
      dockingAdapter: false,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['mars-plant'],
    baseRisk: 0.65,
    rewardRp: 8,
    rewardCredits: 120_000,
    unlock: { kind: 'after', missionIds: ['lunar-landing'] },
    mars: { plantPayloadId: 'mars-plant' },
  },
  {
    id: 'mars-crewed',
    name: 'Mars Expedition',
    destination: 'mars-surface',
    destinationLabel: 'Mars surface and home',
    summary: 'Fly a crew to the propellant plant on Mars, refuel there and bring them home.',
    briefing:
      'Launch inside an Earth–Mars window and cruise to Mars as the cargo ship did, but land next to the propellant plant. The crew connects a propellant line and fills the tanks while they explore. Stay until the Mars–Earth return window opens (more than a year later), lift off to Mars orbit and inject toward Earth. At Earth an aerocapture pass slows the ship into orbit before a normal deorbit and landing. The whole trip takes about two and a half years.',
    objectives: [
      'Refuel in Earth orbit and inject toward Mars inside the window',
      'Land within 2 km of the propellant plant',
      'Surface operations and refuelling from the plant',
      'Lift off inside the return window and fly home',
      'Aerocapture at Earth, re-entry and landing',
    ],
    abortCriteria: [
      'Landing more than 2 km from the plant',
      'Plant stock below what the trip home needs',
    ],
    durationDays: 960,
    // Just orbit (with a small reserve): tankers and the plant fill the tanks for the rest.
    requiredDeltaVMs: 9_300,
    requirements: {
      minCrew: 2,
      maxCrew: 4,
      dockingAdapter: false,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['mars-supplies'],
    baseRisk: 0.8,
    rewardRp: 12,
    rewardCredits: 250_000,
    unlock: { kind: 'after', missionIds: ['mars-cargo'] },
    mars: { crewed: true, suppliesPayloadId: 'mars-supplies' },
  },
];

export function findMission(id: string): MissionDefinition | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function findPayload(id: string): PayloadDefinition | undefined {
  return PAYLOADS.find((p) => p.id === id);
}

export type MissionAvailability = { available: true } | { available: false; reason: string };

export function missionAvailability(
  mission: MissionDefinition,
  completedMissionIds: readonly string[],
): MissionAvailability {
  const u = mission.unlock;
  if (u.kind === 'start') return { available: true };
  if (u.kind === 'later-stage') return { available: false, reason: u.reason };
  const missing = u.missionIds.filter((id) => !completedMissionIds.includes(id));
  if (!missing.length) return { available: true };
  return {
    available: false,
    reason: `Fly ${missing.map((id) => `"${findMission(id)?.name ?? id}"`).join(' and ')} first.`,
  };
}
