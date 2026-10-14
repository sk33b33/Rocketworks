import { certificationStatus } from '../rocket/readiness/certification';
import type { RocketBlueprint } from '../rocket/model/types';
import type { FlightRecord } from '../launch/flightRecord';
import { gradeAtLeast } from '../recovery/rating';
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
  /** Flight history (Stage 6+ recovery milestones). */
  readonly flights?: readonly FlightRecord[];
}

const anyFlight = (ctx: MilestoneContext, test: (f: FlightRecord) => boolean) =>
  (ctx.flights ?? []).some(test);

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
  {
    id: 'first-catch',
    title: 'Caught by the tower',
    description: 'Catch a returning booster with the launch tower arms.',
    rewardRp: 2,
    isAchieved: (ctx) => anyFlight(ctx, (f) => f.recovery?.outcome === 'caught'),
  },
  {
    id: 'platform-landing',
    title: 'Downrange landing',
    description: 'Land a booster on the ocean platform.',
    rewardRp: 1,
    isAchieved: (ctx) => anyFlight(ctx, (f) => f.recovery?.outcome === 'landed'),
  },
  {
    id: 'ship-recovered',
    title: 'Ship recovered',
    description: 'Land the ship on a pad, platform or the coast after an orbital flight.',
    rewardRp: 1,
    isAchieved: (ctx) => anyFlight(ctx, (f) => f.landing?.shipRecovered === true),
  },
  {
    id: 'first-docking',
    title: 'Docked with the station',
    description: 'Dock a ship at the orbital station.',
    rewardRp: 1,
    isAchieved: (ctx) => anyFlight(ctx, (f) => !!f.docking?.grade),
  },
  {
    id: 'manual-ace',
    title: 'Hands on the stick',
    description: 'Fly a booster or ship landing yourself and earn an A rating or better.',
    rewardRp: 1,
    rewardCredits: 25_000,
    isAchieved: (ctx) =>
      anyFlight(
        ctx,
        (f) =>
          (f.recovery?.manual === true && gradeAtLeast(f.recovery.grade, 'A')) ||
          (f.landing?.manual === true && gradeAtLeast(f.landing.grade, 'A')),
      ),
  },
  {
    id: 'flight-proven',
    title: 'Flight-proven',
    description: 'Recover a booster or ship that had already flown before.',
    rewardRp: 1,
    rewardCredits: 25_000,
    isAchieved: (ctx) =>
      anyFlight(
        ctx,
        (f) =>
          (!!f.hardware?.boosterId &&
            (f.recovery?.outcome === 'caught' || f.recovery?.outcome === 'landed')) ||
          (!!f.hardware?.shipId && f.landing?.shipRecovered === true),
      ),
  },
  {
    id: 'lunar-flyby',
    title: 'Around the Moon',
    description: 'Fly past the Moon with a crew aboard.',
    rewardRp: 2,
    isAchieved: (ctx) => anyFlight(ctx, (f) => f.lunar?.flyby === true && f.crewSafe === true),
  },
  {
    id: 'boots-on-the-moon',
    title: 'Boots on the Moon',
    description: 'Land a crewed ship on the Moon.',
    rewardRp: 3,
    rewardCredits: 50_000,
    isAchieved: (ctx) => anyFlight(ctx, (f) => f.lunar?.landing?.outcome === 'landed'),
  },
  {
    id: 'precision-lunar-landing',
    title: 'Pinpoint touchdown',
    description: 'Fly the final lunar descent yourself and earn an A rating or better.',
    rewardRp: 1,
    rewardCredits: 25_000,
    isAchieved: (ctx) =>
      anyFlight(
        ctx,
        (f) =>
          f.lunar?.landing?.outcome === 'landed' &&
          f.lunar.landing.manual &&
          gradeAtLeast(f.lunar.landing.grade, 'A'),
      ),
  },
];

/** Milestones achieved by the context that are not yet recorded. */
export function newlyAchieved(recorded: readonly string[], ctx: MilestoneContext): Milestone[] {
  return MILESTONES.filter((m) => !recorded.includes(m.id) && m.isAchieved(ctx));
}
