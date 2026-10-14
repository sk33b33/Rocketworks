import {
  budgetCredits,
  programDay,
  researchAvailable,
  researchEarned,
  unlockedPartIds,
  type ProgressionState,
} from '../../progression/research';
import { evaluateMission, type MissionReport } from '../../missions/missionReadiness';
import type { MissionSetup } from '../../missions/missionSetup';
import type { FleetVehicle } from '../../fleet/fleet';
import type { RocketBlueprint } from '../../rocket/model/types';
import { evaluateReadiness, type ReadinessReport } from '../../rocket/readiness/readiness';
import { evaluateGuide, type GuideProgress } from '../../rocket/tutorial/starterGuide';

/** Memoized derived values (stable references so React selectors don't loop). */

export interface ProgramSummary {
  readonly budgetCredits: number;
  readonly researchAvailable: number;
  readonly researchEarned: number;
  readonly unlockedPartIds: ReadonlySet<string>;
}

let programCache: { p: ProgressionState; v: ProgramSummary } | null = null;
export function programSummary(p: ProgressionState): ProgramSummary {
  if (programCache?.p !== p) {
    programCache = {
      p,
      v: {
        budgetCredits: budgetCredits(p),
        researchAvailable: researchAvailable(p),
        researchEarned: researchEarned(p),
        unlockedPartIds: unlockedPartIds(p),
      },
    };
  }
  return programCache.v;
}

let guideCache: { bp: RocketBlueprint; v: GuideProgress } | null = null;
export function guideProgress(bp: RocketBlueprint): GuideProgress {
  if (guideCache?.bp !== bp) guideCache = { bp, v: evaluateGuide(bp) };
  return guideCache.v;
}

/** Per-design cache so the factory and Mission Control can ask about different designs. */
const readinessCache = new WeakMap<RocketBlueprint, { p: ProgressionState; v: ReadinessReport }>();
export function readinessReport(bp: RocketBlueprint, p: ProgressionState): ReadinessReport {
  const hit = readinessCache.get(bp);
  if (hit && hit.p === p) return hit.v;
  const prog = programSummary(p);
  const v = evaluateReadiness(bp, {
    unlockedPartIds: prog.unlockedPartIds,
    budgetCredits: prog.budgetCredits,
  });
  readinessCache.set(bp, { p, v });
  return v;
}

const NO_FLEET: readonly FleetVehicle[] = [];
let missionCache: {
  setup: MissionSetup;
  blueprints: readonly RocketBlueprint[];
  p: ProgressionState;
  fleet: readonly FleetVehicle[];
  v: MissionReport;
} | null = null;
/** Mission readiness for the current plan (the assigned design is looked up in the library). */
export function missionReport(
  setup: MissionSetup,
  blueprints: readonly RocketBlueprint[],
  p: ProgressionState,
  fleet: readonly FleetVehicle[] = NO_FLEET,
): MissionReport {
  if (
    missionCache?.setup !== setup ||
    missionCache.blueprints !== blueprints ||
    missionCache.p !== p ||
    missionCache.fleet !== fleet
  ) {
    const bp = blueprints.find((b) => b.id === setup.designId);
    missionCache = {
      setup,
      blueprints,
      p,
      fleet,
      v: evaluateMission({
        setup,
        blueprint: bp,
        vehicleReport: bp ? readinessReport(bp, p) : undefined,
        completedMissionIds: p.completedMissions,
        fleet,
        budgetCredits: programSummary(p).budgetCredits,
        rapidReuse: p.tech.includes('rapid-reuse'),
        logistics: {
          heavyTankers: p.tech.includes('heavy-tankers'),
          lunarLogistics: p.tech.includes('lunar-logistics'),
        },
        calendarDay: programDay(p),
      }),
    };
  }
  return missionCache.v;
}
