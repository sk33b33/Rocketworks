/** Fictional astronaut corps. Names and biographies are invented for the game. */

export type CrewRole = 'commander' | 'pilot' | 'flight-engineer' | 'mission-specialist';
export type CrewStatus = 'ready' | 'fatigued' | 'medical-hold';

export interface CrewMember {
  readonly id: string;
  readonly name: string;
  readonly role: CrewRole;
  /** 1 (rookie) to 5 (veteran). */
  readonly skill: number;
  readonly status: CrewStatus;
  readonly statusNote?: string;
  readonly bio: string;
}

export const ROLE_LABELS: Record<CrewRole, string> = {
  commander: 'Commander',
  pilot: 'Pilot',
  'flight-engineer': 'Flight Engineer',
  'mission-specialist': 'Mission Specialist',
};

export const STATUS_LABELS: Record<CrewStatus, string> = {
  ready: 'Ready',
  fatigued: 'Fatigued',
  'medical-hold': 'Medical hold',
};

export const CREW_ROSTER: readonly CrewMember[] = [
  {
    id: 'okafor',
    name: 'Mara Okafor',
    role: 'commander',
    skill: 5,
    status: 'ready',
    bio: 'Former test pilot; has commanded every integrated simulator campaign.',
  },
  {
    id: 'lindqvist',
    name: 'Tomas Lindqvist',
    role: 'pilot',
    skill: 4,
    status: 'ready',
    bio: 'Rendezvous specialist with a calm voice on the loop.',
  },
  {
    id: 'raman',
    name: 'Priya Raman',
    role: 'flight-engineer',
    skill: 4,
    status: 'ready',
    bio: 'Propulsion engineer who helped qualify the Forge engines.',
  },
  {
    id: 'sato',
    name: 'Kenji Sato',
    role: 'mission-specialist',
    skill: 3,
    status: 'ready',
    bio: 'Materials scientist responsible for the microgravity science pod.',
  },
  {
    id: 'voss',
    name: 'Elena Voss',
    role: 'pilot',
    skill: 3,
    status: 'fatigued',
    statusNote: 'Just finished a 48-hour simulator marathon.',
    bio: 'Backup pilot; fast learner with excellent manual-flying scores.',
  },
  {
    id: 'adeyemi',
    name: 'Samuel Adeyemi',
    role: 'commander',
    skill: 4,
    status: 'medical-hold',
    statusNote: 'Recovering from a minor knee injury; not cleared to fly.',
    bio: 'Veteran commander and flight surgeon liaison.',
  },
  {
    id: 'alvarez',
    name: 'Diego Alvarez',
    role: 'flight-engineer',
    skill: 2,
    status: 'ready',
    bio: 'Rookie engineer, top of the latest astronaut class.',
  },
];

/** Mass of one crew member plus suit, seat share and consumables. Game value. */
export const CREW_MASS_KG = 150;

export function findCrew(id: string): CrewMember | undefined {
  return CREW_ROSTER.find((c) => c.id === id);
}
