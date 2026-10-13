import {
  budgetCredits,
  researchAvailable,
  researchEarned,
  unlockedPartIds,
  type ProgressionState,
} from '../../progression/research';
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

let readinessCache: { bp: RocketBlueprint; p: ProgressionState; v: ReadinessReport } | null = null;
export function readinessReport(bp: RocketBlueprint, p: ProgressionState): ReadinessReport {
  if (readinessCache?.bp !== bp || readinessCache.p !== p) {
    const prog = programSummary(p);
    readinessCache = {
      bp,
      p,
      v: evaluateReadiness(bp, {
        unlockedPartIds: prog.unlockedPartIds,
        budgetCredits: prog.budgetCredits,
      }),
    };
  }
  return readinessCache.v;
}
