/*
 * Program progression: research points (RP) are earned from one-time milestones and spent on tech
 * nodes that unlock parts or raise the program budget. Everything is derived from the lists of
 * achieved milestones and purchased tech, so saves stay small and self-consistent.
 */
import { PARTS } from '../rocket/catalog/parts';
import { findMission, MISSIONS } from '../missions/missionCatalog';
import { MILESTONES } from './milestones';
import type { MarsBase } from '../mars/marsRules';

export interface ProgressionState {
  readonly milestones: readonly string[];
  readonly tech: readonly string[];
  /** Missions flown successfully (first completion pays the reward). */
  readonly completedMissions: readonly string[];
  /** Program calendar (days since day 0): flights and waiting for launch windows advance it. */
  readonly calendarDay?: number;
  /** The propellant plant left on Mars by a cargo landing. */
  readonly marsBase?: MarsBase | null;
}

/** The program's current day. */
export const programDay = (p: ProgressionState): number => p.calendarDay ?? 0;

export interface TechNode {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly costRp: number;
  readonly requires: readonly string[];
  readonly budgetBonusCredits?: number;
}

/** Starting program budget: the most a single vehicle design may cost. Game value. */
export const BASE_BUDGET_CREDITS = 150_000;

export const TECH_TREE: readonly TechNode[] = [
  {
    id: 'long-duration-power',
    name: 'Long-Duration Power',
    description: 'Unlocks the Deployable Solar Array detail module.',
    costRp: 1,
    requires: [],
  },
  {
    id: 'extended-tankage',
    name: 'Extended Tankage',
    description: 'Unlocks the Extended Ship Tank (+50% propellant per section).',
    costRp: 2,
    requires: [],
  },
  {
    id: 'program-expansion',
    name: 'Program Expansion',
    description: 'Raises the program budget by 50,000 cr.',
    costRp: 2,
    requires: [],
    budgetBonusCredits: 50_000,
  },
  {
    id: 'engine-block-2',
    name: 'Engine Block 2',
    description: 'Unlocks the uprated Forge-SL Block 2 engine.',
    costRp: 3,
    requires: [],
  },
  {
    id: 'vacuum-propulsion',
    name: 'Vacuum Propulsion',
    description: 'Unlocks the Forge-V vacuum engine for the ship.',
    costRp: 3,
    requires: ['engine-block-2'],
  },
  {
    id: 'rapid-reuse',
    name: 'Rapid Reuse',
    description:
      'Streamlined inspections: reflying recovered hardware costs less and refurbishment is cheaper.',
    costRp: 3,
    requires: [],
  },
  {
    id: 'fleet-operations',
    name: 'Fleet Operations',
    description: 'Raises the program budget by 75,000 cr.',
    costRp: 3,
    requires: ['rapid-reuse'],
    budgetBonusCredits: 75_000,
  },
  {
    id: 'heavy-tankers',
    name: 'Heavy Tankers',
    description:
      'Stretched tanker ships: orbital refuelling needs fewer tanker flights (+50% each).',
    costRp: 3,
    requires: [],
  },
  {
    id: 'lunar-logistics',
    name: 'Lunar Logistics',
    description: 'Regular depot resupply: the lunar depot top-up costs 40% less.',
    costRp: 3,
    requires: ['heavy-tankers'],
  },
  {
    id: 'ice-mining',
    name: 'Ice Mining Rigs',
    description: 'Better drills for the Mars propellant plant: it makes 50% more propellant.',
    costRp: 4,
    requires: [],
  },
];

export const INITIAL_PROGRESSION: ProgressionState = {
  milestones: [],
  tech: [],
  completedMissions: [],
};

export function findTech(id: string): TechNode | undefined {
  return TECH_TREE.find((t) => t.id === id);
}

const completed = (p: ProgressionState) =>
  MISSIONS.filter((m) => p.completedMissions.includes(m.id));

export function researchEarned(p: ProgressionState): number {
  const fromMilestones = MILESTONES.filter((m) => p.milestones.includes(m.id)).reduce(
    (s, m) => s + m.rewardRp,
    0,
  );
  return fromMilestones + completed(p).reduce((s, m) => s + m.rewardRp, 0);
}

export function researchSpent(p: ProgressionState): number {
  return TECH_TREE.filter((t) => p.tech.includes(t.id)).reduce((s, t) => s + t.costRp, 0);
}

export function researchAvailable(p: ProgressionState): number {
  return researchEarned(p) - researchSpent(p);
}

export function budgetCredits(p: ProgressionState): number {
  const fromMilestones = MILESTONES.filter((m) => p.milestones.includes(m.id)).reduce(
    (s, m) => s + (m.rewardCredits ?? 0),
    0,
  );
  const fromTech = TECH_TREE.filter((t) => p.tech.includes(t.id)).reduce(
    (s, t) => s + (t.budgetBonusCredits ?? 0),
    0,
  );
  const fromMissions = completed(p).reduce((s, m) => s + m.rewardCredits, 0);
  return BASE_BUDGET_CREDITS + fromMilestones + fromTech + fromMissions;
}

/**
 * Records a successful mission; the first completion pays its RP and budget reward (derived).
 * Called by the flight stages; repeat flights are allowed but pay nothing extra.
 */
export function completeMission(
  p: ProgressionState,
  missionId: string,
): { ok: true; progression: ProgressionState; firstTime: boolean } | { ok: false; reason: string } {
  if (!findMission(missionId)) return { ok: false, reason: 'Unknown mission.' };
  if (p.completedMissions.includes(missionId))
    return { ok: true, progression: p, firstTime: false };
  return {
    ok: true,
    progression: { ...p, completedMissions: [...p.completedMissions, missionId] },
    firstTime: true,
  };
}

/** Parts unlocked through research (parts unlocked by default are not listed). */
export function unlockedPartIds(p: ProgressionState): Set<string> {
  return new Set(
    PARTS.filter(
      (part) => !part.unlock.unlocked && part.unlock.techId && p.tech.includes(part.unlock.techId),
    ).map((part) => part.id),
  );
}

export type TechAvailability = { ok: true } | { ok: false; reason: string };

export function canResearch(p: ProgressionState, techId: string): TechAvailability {
  const node = findTech(techId);
  if (!node) return { ok: false, reason: 'Unknown research project.' };
  if (p.tech.includes(techId)) return { ok: false, reason: 'Already researched.' };
  const missing = node.requires.filter((r) => !p.tech.includes(r));
  if (missing.length) {
    return {
      ok: false,
      reason: `Requires ${missing.map((r) => findTech(r)?.name ?? r).join(', ')} first.`,
    };
  }
  const available = researchAvailable(p);
  if (available < node.costRp) {
    return {
      ok: false,
      reason: `Needs ${node.costRp} RP; you have ${available}. Earn more from milestones.`,
    };
  }
  return { ok: true };
}

export function purchaseTech(
  p: ProgressionState,
  techId: string,
): { ok: true; progression: ProgressionState } | { ok: false; reason: string } {
  const check = canResearch(p, techId);
  if (!check.ok) return check;
  return { ok: true, progression: { ...p, tech: [...p.tech, techId] } };
}
