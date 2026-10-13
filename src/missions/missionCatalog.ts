/*
 * Mission and payload catalog. Destinations are fictionalized; Δv requirements, durations and
 * rewards are game values chosen for progression, not mission-design data.
 */

export type Destination = 'suborbital' | 'leo' | 'station' | 'lunar-orbit' | 'lunar-surface';

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
}

export interface PayloadDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly massKg: number;
  /** Needs a Cargo Bay Module; otherwise it rides in the ship structure or cabin. */
  readonly requiresBay: boolean;
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
      'Our first deep-space flight. Expect long communication delays and a high-energy re-entry on return. Propellant margins are tight; extended tanks or vacuum engines are recommended.',
    objectives: [
      'Trans-lunar injection',
      'Lunar flyby photography',
      'Return and high-speed re-entry',
    ],
    abortCriteria: ['Trans-lunar injection under-burn', 'Life-support margin below 20%'],
    durationDays: 8,
    requiredDeltaVMs: 11_800,
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
  },
  {
    id: 'lunar-landing',
    name: 'Lunar Landing',
    destination: 'lunar-surface',
    destinationLabel: 'Lunar surface',
    summary: 'Land a crew on the Moon and return them safely.',
    briefing: 'Planned for the Moon program.',
    objectives: ['Land at the selected site', 'Surface operations', 'Ascent and return'],
    abortCriteria: ['Landing site hazards exceed limits'],
    durationDays: 14,
    requiredDeltaVMs: 15_000,
    requirements: {
      minCrew: 2,
      maxCrew: 4,
      dockingAdapter: true,
      rcs: 'critical',
      antenna: 'critical',
      reentry: true,
    },
    payloadIds: ['none'],
    baseRisk: 0.7,
    rewardRp: 8,
    rewardCredits: 100_000,
    unlock: {
      kind: 'later-stage',
      reason: 'Moon landings arrive with the Moon program in a later stage.',
    },
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
