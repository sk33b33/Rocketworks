import { certificationStatus } from '../rocket/readiness/certification';
import type { RocketBlueprint } from '../rocket/model/types';
import { evaluateGuide, STARTER_GUIDE } from '../rocket/tutorial/starterGuide';

/** One-time program achievements. Once earned they are never revoked. */
export interface Milestone {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly rewardRp: number;
  readonly rewardCredits?: number;
  isAchieved(ctx: MilestoneContext): boolean;
}

export interface MilestoneContext {
  readonly blueprints: readonly RocketBlueprint[];
}

const stepDone = (bp: RocketBlueprint, ...ids: string[]) =>
  ids.every((id) => STARTER_GUIDE.find((s) => s.id === id)?.isDone(bp) ?? false);

const anyBp = (ctx: MilestoneContext, test: (bp: RocketBlueprint) => boolean) =>
  ctx.blueprints.some(test);

export const MILESTONES: readonly Milestone[] = [
  {
    id: 'booster-lit',
    title: 'Engines installed',
    description: 'Fit every engine mount on a booster.',
    rewardRp: 1,
    isAchieved: (ctx) => anyBp(ctx, (bp) => stepDone(bp, 'booster-engines')),
  },
  {
    id: 'booster-complete',
    title: 'Booster complete',
    description: 'Finish a booster: engines, 3 tanks, forward section, grid fins and legs.',
    rewardRp: 1,
    isAchieved: (ctx) =>
      anyBp(ctx, (bp) =>
        stepDone(
          bp,
          'booster-engines',
          'booster-tanks',
          'booster-forward',
          'grid-fins',
          'booster-legs',
        ),
      ),
  },
  {
    id: 'full-stack',
    title: 'First full stack',
    description: 'Complete every required step of the guided build.',
    rewardRp: 2,
    rewardCredits: 25_000,
    isAchieved: (ctx) => anyBp(ctx, (bp) => evaluateGuide(bp).completeness === 1),
  },
  {
    id: 'outfitted',
    title: 'Fully outfitted',
    description: 'Fit a docking adapter and at least two detail modules.',
    rewardRp: 1,
    isAchieved: (ctx) => anyBp(ctx, (bp) => stepDone(bp, 'docking', 'outfit')),
  },
  {
    id: 'first-certified',
    title: 'Flight certified',
    description: 'Certify a design for flight without using the override.',
    rewardRp: 2,
    rewardCredits: 25_000,
    isAchieved: (ctx) => anyBp(ctx, (bp) => certificationStatus(bp) === 'valid'),
  },
  {
    id: 'crew-rated',
    title: 'Crew rated',
    description: 'Certify a crew-role design without using the override.',
    rewardRp: 1,
    isAchieved: (ctx) =>
      anyBp(ctx, (bp) => bp.role === 'crew' && certificationStatus(bp) === 'valid'),
  },
  {
    id: 'design-bureau',
    title: 'Design bureau',
    description: 'Keep two or more designs with at least 10 parts each.',
    rewardRp: 1,
    isAchieved: (ctx) => ctx.blueprints.filter((bp) => bp.parts.length >= 10).length >= 2,
  },
];

/** Milestones achieved by the context that are not yet recorded. */
export function newlyAchieved(recorded: readonly string[], ctx: MilestoneContext): Milestone[] {
  return MILESTONES.filter((m) => !recorded.includes(m.id) && m.isAchieved(ctx));
}
