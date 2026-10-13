import { newlyAchieved } from '../../progression/milestones';
import type { ProgressionState } from '../../progression/research';
import { findInstance } from '../../rocket/assembly/compatibility';
import { replaceInList } from '../../rocket/library/blueprintLibrary';
import type { RocketBlueprint } from '../../rocket/model/types';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { STARTER_GUIDE } from '../../rocket/tutorial/starterGuide';
import { programSummary } from './derived';
import type { GameStore, GetState, Notice, NoticeTone, Selection, SetState } from './types';

export const HISTORY_LIMIT = 100;

let noticeSeq = 1;
export function makeNotice(tone: NoticeTone, text: string, sticky = false): Notice {
  return { id: ++noticeSeq, tone, text, ...(sticky ? { sticky } : {}) };
}

export const now = () => new Date().toISOString();

let idSeq = 0;
export function newBlueprintId(): string {
  return `bp-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;
}

/** Records newly achieved milestones; returns the updated progression and a notice suffix. */
export function awardMilestones(
  progression: ProgressionState,
  blueprints: readonly RocketBlueprint[],
): { progression: ProgressionState; text: string } {
  const achieved = newlyAchieved(progression.milestones, { blueprints });
  if (!achieved.length) return { progression, text: '' };
  const text = achieved
    .map((m) => {
      const rewards = [`+${m.rewardRp} RP`];
      if (m.rewardCredits) rewards.push(`+${m.rewardCredits.toLocaleString('en-US')} cr budget`);
      return ` 🏆 Milestone "${m.title}" (${rewards.join(', ')}).`;
    })
    .join('');
  return {
    progression: {
      ...progression,
      milestones: [...progression.milestones, ...achieved.map((m) => m.id)],
    },
    text,
  };
}

function stepSuffix(before: RocketBlueprint, after: RocketBlueprint): string {
  const done = STARTER_GUIDE.filter((s) => !s.isDone(before) && s.isDone(after));
  return done.length ? ` ✓ Step complete: ${done.map((s) => s.title).join('; ')}.` : '';
}

/** Keeps an instance selection only if the instance still exists. */
export function validSelection(selection: Selection, bp: RocketBlueprint): Selection {
  return selection?.kind === 'instance' && !findInstance(bp, selection.instanceId)
    ? null
    : selection;
}

export interface CommitOptions {
  /** Push the previous design onto the undo stack (default true). */
  record?: boolean;
  /** Refuse changes that raise the cost above the budget (default true). */
  budgetCheck?: boolean;
  reportSteps?: boolean;
  extra?: Partial<GameStore>;
}

/**
 * The single path for changing the active design: enforces the budget, records undo history,
 * syncs the design library, awards milestones and posts a notice.
 */
export function commitBlueprint(
  set: SetState,
  get: GetState,
  next: RocketBlueprint,
  message: string,
  { record = true, budgetCheck = true, reportSteps = true, extra = {} }: CommitOptions = {},
): boolean {
  const s = get();
  const prev = s.blueprint;
  if (budgetCheck) {
    const budget = programSummary(s.progression).budgetCredits;
    const before = calculateRocketStats(prev).costCredits;
    const after = calculateRocketStats(next).costCredits;
    if (after > budget && after > before) {
      set({
        notice: makeNotice(
          'warning',
          `Over budget: this change would cost ${after.toLocaleString('en-US')} cr against a ${budget.toLocaleString('en-US')} cr budget. Earn milestones or research Program Expansion for more.`,
        ),
      });
      return false;
    }
  }
  const blueprints = replaceInList(s.blueprints, next);
  const { progression, text } = awardMilestones(s.progression, blueprints);
  set({
    blueprint: next,
    blueprints,
    progression,
    history: record
      ? { past: [...s.history.past, prev].slice(-HISTORY_LIMIT), future: [] }
      : s.history,
    selection: validSelection(s.selection, next),
    notice: makeNotice('success', message + (reportSteps ? stepSuffix(prev, next) : '') + text),
    ...extra,
  });
  return true;
}
