import type { RecoveryTarget } from '../recovery/recoveryPlan';
import { CONTRACT_MISSION, type ContractKind } from '../economy/contracts';
import { defaultRefuel, type RefuelChoice } from '../moon/lunarRules';
import { CREW_ROSTER, findCrew } from './crew';
import { initialConditionsSeed, nextWindowSeed } from './conditions';
import {
  findMission,
  missionAvailability,
  MISSIONS,
  type MissionDefinition,
} from './missionCatalog';

/** Refuelling a mission starts with: the legs it can't fly without (Mars: tankers in orbit). */
export function missionRefuelDefault(m: MissionDefinition): RefuelChoice {
  return m.mars ? { leo: true, depot: false } : defaultRefuel(m.lunar);
}

/** What the player has planned in Mission Control. Pure data; persisted with the save. */
export interface MissionCommit {
  readonly designId: string;
  readonly revision: number;
  readonly at: string;
  /** What the flight costs (cr), paid from the treasury when it flies. */
  readonly cost?: number;
  /** The contract this flight is for. */
  readonly contractId?: string;
}

export interface MissionSetup {
  readonly missionId: string;
  readonly designId: string | null;
  readonly crewIds: readonly string[];
  readonly payloadId: string;
  readonly conditionsSeed: number;
  readonly waits: number;
  /** Set by "Commit mission"; any planning change clears it. */
  readonly commit: MissionCommit | null;
  /** Booster recovery choice; null = best option the hardware allows. */
  readonly recovery: RecoveryTarget | null;
  /** Recovered hardware assigned to fly again (null = new build). */
  readonly boosterFleetId: string | null;
  readonly shipFleetId: string | null;
  /** Moon missions: tanker flights in Earth orbit and the lunar depot top-up. */
  readonly refuel: RefuelChoice;
}

export type SetupResult = { ok: true; setup: MissionSetup } | { ok: false; reason: string };

export function createDefaultSetup(designId: string | null): MissionSetup {
  const first = MISSIONS[0]!;
  return {
    missionId: first.id,
    designId,
    crewIds: [],
    payloadId: 'none',
    conditionsSeed: initialConditionsSeed(first.id),
    waits: 0,
    commit: null,
    recovery: null,
    boosterFleetId: null,
    shipFleetId: null,
    refuel: missionRefuelDefault(first),
  };
}

/** Switching missions keeps compatible choices and trims the rest. */
export function selectMission(
  setup: MissionSetup,
  missionId: string,
  completedMissionIds: readonly string[],
): SetupResult {
  const mission = findMission(missionId);
  if (!mission) return { ok: false, reason: 'Unknown mission.' };
  const availability = missionAvailability(mission, completedMissionIds);
  if (!availability.available) return { ok: false, reason: availability.reason };
  if (missionId === setup.missionId) return { ok: true, setup };
  return {
    ok: true,
    setup: {
      ...setup,
      missionId,
      crewIds: setup.crewIds.slice(0, mission.requirements.maxCrew),
      payloadId: mission.mars
        ? (mission.mars.plantPayloadId ?? mission.mars.suppliesPayloadId ?? 'none')
        : mission.payloadIds.includes(setup.payloadId)
          ? setup.payloadId
          : 'none',
      conditionsSeed: initialConditionsSeed(missionId),
      waits: 0,
      commit: null,
      refuel: missionRefuelDefault(mission),
    },
  };
}

export function setMissionDesign(setup: MissionSetup, designId: string): MissionSetup {
  return setup.designId === designId
    ? setup
    : { ...setup, designId, commit: null, boosterFleetId: null, shipFleetId: null };
}

export function setPayload(setup: MissionSetup, payloadId: string): SetupResult {
  const mission = findMission(setup.missionId);
  if (!mission?.payloadIds.includes(payloadId)) {
    return { ok: false, reason: 'That payload is not offered for this mission.' };
  }
  return { ok: true, setup: { ...setup, payloadId, commit: null } };
}

/** Adds or removes an astronaut, refusing assignments that can never be valid. */
export function toggleCrew(setup: MissionSetup, crewId: string): SetupResult {
  const mission = findMission(setup.missionId);
  const member = findCrew(crewId);
  if (!mission || !member) return { ok: false, reason: 'Unknown mission or crew member.' };
  if (setup.crewIds.includes(crewId)) {
    return {
      ok: true,
      setup: { ...setup, crewIds: setup.crewIds.filter((id) => id !== crewId), commit: null },
    };
  }
  if (mission.requirements.maxCrew === 0)
    return { ok: false, reason: `${mission.name} is uncrewed.` };
  if (member.status === 'medical-hold') {
    return { ok: false, reason: `${member.name} is on medical hold and cannot be assigned.` };
  }
  if (setup.crewIds.length >= mission.requirements.maxCrew) {
    return {
      ok: false,
      reason: `${mission.name} carries at most ${mission.requirements.maxCrew} crew.`,
    };
  }
  // Keep roster order for a stable manifest.
  const crewIds = CREW_ROSTER.map((c) => c.id).filter(
    (id) => id === crewId || setup.crewIds.includes(id),
  );
  return { ok: true, setup: { ...setup, crewIds, commit: null } };
}

/** Stand down and wait for the next launch window (new weather draw). Free in this stage. */
export function waitForNextWindow(setup: MissionSetup): MissionSetup {
  return {
    ...setup,
    conditionsSeed: nextWindowSeed(setup.conditionsSeed),
    waits: setup.waits + 1,
    commit: null,
  };
}

export function setRecovery(setup: MissionSetup, recovery: RecoveryTarget | null): MissionSetup {
  return setup.recovery === recovery ? setup : { ...setup, recovery, commit: null };
}

/** Assigns recovered hardware (or a new build with null) to the booster or ship. */
export function assignFleet(
  setup: MissionSetup,
  kind: 'booster' | 'ship',
  vehicleId: string | null,
): MissionSetup {
  const key = kind === 'booster' ? 'boosterFleetId' : 'shipFleetId';
  return setup[key] === vehicleId ? setup : { ...setup, [key]: vehicleId, commit: null };
}

/** Buys or drops a refuelling option (Moon missions). */
export function setRefuel(
  setup: MissionSetup,
  kind: keyof RefuelChoice,
  on: boolean,
): MissionSetup {
  return setup.refuel[kind] === on
    ? setup
    : { ...setup, refuel: { ...setup.refuel, [kind]: on }, commit: null };
}

/** Sets up Mission Control for an accepted contract: its mission, payload and default refuelling. */
export function setupForContract(
  setup: MissionSetup,
  contract: { readonly kind: ContractKind; readonly payloadId: string },
): MissionSetup {
  const mission = findMission(CONTRACT_MISSION[contract.kind])!;
  return {
    ...setup,
    missionId: mission.id,
    crewIds: setup.crewIds.slice(0, mission.requirements.maxCrew),
    payloadId: contract.payloadId,
    conditionsSeed: initialConditionsSeed(mission.id),
    waits: 0,
    commit: null,
    refuel: missionRefuelDefault(mission),
  };
}
