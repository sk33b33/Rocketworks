import { isPartUnlocked, listFreeSockets } from '../assembly/compatibility';
import { findPart } from '../catalog/parts';
import type { RocketBlueprint, VehicleRole } from '../model/types';
import {
  calculateRocketStats,
  instanceStages,
  type RocketStats,
} from '../stats/calculateRocketStats';
import {
  CREW_RESERVE_DELTA_V_MS,
  estimateDeltaV,
  ORBIT_DELTA_V_MS,
  type DeltaVEstimate,
} from './deltaV';

/*
 * Vehicle readiness: deterministic rules that explain why a design can or cannot fly and how to
 * fix it. Critical issues block certification (unless overridden); warnings do not.
 */

export type Severity = 'critical' | 'warning';

/** Something the UI can do for the player to start fixing an issue. */
export type FixAction =
  | { readonly kind: 'select-part'; readonly partId: string }
  | { readonly kind: 'guide-step'; readonly stepId: string }
  | { readonly kind: 'select-instance'; readonly instanceId: string }
  | { readonly kind: 'set-role'; readonly role: VehicleRole }
  | { readonly kind: 'open-program' };

export interface ReadinessIssue {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly fix: string;
  readonly action?: FixAction;
  readonly actionLabel?: string;
}

export interface Capability {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
}

export interface ReadinessReport {
  readonly status: 'ready' | 'warnings' | 'blocked';
  readonly issues: readonly ReadinessIssue[];
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly stats: RocketStats;
  readonly deltaV: DeltaVEstimate;
  readonly requiredDeltaVMs: number;
  readonly capabilities: readonly Capability[];
}

export interface ReadinessContext {
  readonly unlockedPartIds: ReadonlySet<string>;
  readonly budgetCredits: number;
}

export const TWR_MIN = 1.0;
export const TWR_COMFORTABLE = 1.2;
/** Ship wet mass above this share of liftoff mass is flagged as too heavy for the booster. */
export const SHIP_MASS_SHARE_MAX = 0.45;

const SHIP_SECTION_IDS = [
  'ship-aft-section',
  'ship-tank',
  'ship-tank-extended',
  'crew-cabin',
  'cargo-bay',
  'nose-cone',
];

export function requiredDeltaV(role: VehicleRole): number {
  return ORBIT_DELTA_V_MS + (role === 'crew' ? CREW_RESERVE_DELTA_V_MS : 0);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function evaluateReadiness(bp: RocketBlueprint, ctx: ReadinessContext): ReadinessReport {
  const stats = calculateRocketStats(bp);
  const deltaV = estimateDeltaV(bp);
  const required = requiredDeltaV(bp.role);
  const issues: ReadinessIssue[] = [];
  const crew = bp.role === 'crew';

  const count = (...ids: string[]) => bp.parts.filter((p) => ids.includes(p.partId)).length;
  const has = (...ids: string[]) => count(...ids) > 0;
  const freeSockets = listFreeSockets(bp);
  const freeOn = (parentPartIds: string[], type: string) =>
    freeSockets.filter((f) => {
      if (f.socket.type !== type || !f.ref.parentId) return false;
      const parent = bp.parts.find((p) => p.id === f.ref.parentId);
      return !!parent && parentPartIds.includes(parent.partId);
    }).length;

  if (bp.parts.length === 0) {
    issues.push({
      id: 'empty',
      severity: 'critical',
      title: 'Nothing on the assembly stand',
      detail: 'A vehicle starts with a Booster Engine Section on the stand.',
      fix: 'Place a Booster Engine Section.',
      action: { kind: 'guide-step', stepId: 'booster-base' },
      actionLabel: 'Place it',
    });
    return finish(issues, stats, deltaV, required, bp);
  }

  // ---- Booster ----
  if (stats.booster.engineCount === 0) {
    issues.push({
      id: 'no-booster-engines',
      severity: 'critical',
      title: 'Booster has no engines',
      detail: 'Without engines on the booster engine section the vehicle cannot lift off.',
      fix: 'Fit engines to every booster engine mount.',
      action: { kind: 'select-part', partId: 'engine-sl' },
      actionLabel: 'Select engine',
    });
  } else {
    const free = freeOn(['booster-engine-section'], 'engine');
    if (free > 0) {
      issues.push({
        id: 'booster-engines-partial',
        severity: 'warning',
        title: `Booster engine mounts not all filled (${free} empty)`,
        detail: 'Empty mounts make thrust asymmetric and waste liftoff performance.',
        fix: 'Fill the remaining booster engine mounts.',
        action: { kind: 'guide-step', stepId: 'booster-engines' },
        actionLabel: 'Fill mounts',
      });
    }
  }
  if (!has('booster-forward-section')) {
    issues.push({
      id: 'booster-open',
      severity: 'critical',
      title: 'Booster stack is not capped',
      detail:
        'The booster needs its forward section (with the interstage ring on top) to carry the ship.',
      fix: 'Add a Booster Forward Section above the last booster tank.',
      action: { kind: 'select-part', partId: 'booster-forward-section' },
      actionLabel: 'Select part',
    });
  }

  // ---- Ship ----
  const hasShip = has('ship-aft-section');
  if (!hasShip) {
    const needInterstage = !has('hot-stage-interstage');
    issues.push({
      id: 'no-ship',
      severity: 'critical',
      title: 'No upper stage',
      detail: 'A two-stage vehicle needs a ship on top of the booster to reach orbit.',
      fix: needInterstage
        ? 'Install the hot-stage interstage, then a Ship Aft Section.'
        : 'Add a Ship Aft Section on the interstage.',
      action: {
        kind: 'select-part',
        partId: needInterstage ? 'hot-stage-interstage' : 'ship-aft-section',
      },
      actionLabel: 'Select part',
    });
  } else {
    if (stats.ship.engineCount === 0) {
      issues.push({
        id: 'ship-no-engines',
        severity: 'critical',
        title: 'Ship has no engines',
        detail: 'The ship cannot finish the climb to orbit or return without engines.',
        fix: 'Fit engines to the ship aft section mounts.',
        action: { kind: 'guide-step', stepId: 'ship-engines' },
        actionLabel: 'Fit engines',
      });
    } else if (freeOn(['ship-aft-section'], 'engine') > 0) {
      issues.push({
        id: 'ship-engines-partial',
        severity: 'warning',
        title: 'Ship engine mounts not all filled',
        detail: 'Empty ship engine mounts reduce thrust and make it asymmetric.',
        fix: 'Fill the remaining ship engine mounts.',
        action: { kind: 'guide-step', stepId: 'ship-engines' },
        actionLabel: 'Fill mounts',
      });
    }
    if (!has('nose-cone')) {
      issues.push({
        id: 'ship-open-top',
        severity: 'critical',
        title: 'Ship has an open top',
        detail:
          'The ship stack must be closed by a nose cone for aerodynamic and structural integrity.',
        fix: 'Add a Nose Cone to the top of the ship stack.',
        action: { kind: 'select-part', partId: 'nose-cone' },
        actionLabel: 'Select nose cone',
      });
    }

    // Re-entry hardware.
    const shieldGaps = freeOn(SHIP_SECTION_IDS, 'heat-shield');
    if (shieldGaps > 0) {
      issues.push({
        id: 'heat-shield-gaps',
        severity: crew ? 'critical' : 'warning',
        title: `Heat shield incomplete (${shieldGaps} section${shieldGaps > 1 ? 's' : ''} bare)`,
        detail: crew
          ? 'Crewed ships must be fully tiled to survive re-entry.'
          : 'Bare sections will likely be lost on re-entry; the ship would be expendable.',
        fix: 'Attach Heat-Shield Tile Sections to every ship section.',
        action: { kind: 'guide-step', stepId: 'heat-shield' },
        actionLabel: 'Tile ship',
      });
    }
    const fwd = count('flap-forward');
    const aft = count('flap-aft');
    if (fwd < 2 || aft < 2) {
      issues.push({
        id: 'flaps',
        severity: crew ? 'critical' : 'warning',
        title: `Flaps incomplete (forward ${fwd}/2, aft ${aft}/2)`,
        detail: 'Without paired flaps the ship cannot control its belly-flop re-entry.',
        fix: 'Attach two forward and two aft flaps.',
        action: { kind: 'guide-step', stepId: 'flaps' },
        actionLabel: 'Add flaps',
      });
    }
  }

  // ---- Role ----
  if (crew && !has('crew-cabin')) {
    issues.push({
      id: 'crew-cabin',
      severity: 'critical',
      title: 'Crew role but no crew cabin',
      detail: 'This design is set to fly crew, but has no pressurized cabin.',
      fix: 'Add a Crew Cabin, or switch the design role to Cargo.',
      action: { kind: 'select-part', partId: 'crew-cabin' },
      actionLabel: 'Select cabin',
    });
  }
  if (!crew && hasShip && !has('cargo-bay', 'crew-cabin')) {
    issues.push({
      id: 'no-payload',
      severity: 'warning',
      title: 'No payload bay',
      detail: 'A cargo vehicle without a payload module can only fly test missions.',
      fix: 'Add a Cargo Bay Module to the ship stack.',
      action: { kind: 'select-part', partId: 'cargo-bay' },
      actionLabel: 'Select bay',
    });
  }

  // ---- Performance ----
  const twr = stats.liftoffTwr;
  if (twr !== null && twr < TWR_MIN) {
    issues.push({
      id: 'twr-low',
      severity: 'critical',
      title: `Too heavy to lift off (TWR ${twr.toFixed(2)})`,
      detail: 'Booster thrust is less than the weight of the fully fuelled vehicle.',
      fix: 'Fill all booster engine mounts, use stronger engines, or carry less propellant.',
      action: { kind: 'guide-step', stepId: 'booster-engines' },
      actionLabel: 'Fill mounts',
    });
  } else if (twr !== null && twr < TWR_COMFORTABLE) {
    issues.push({
      id: 'twr-marginal',
      severity: 'warning',
      title: `Marginal liftoff thrust (TWR ${twr.toFixed(2)})`,
      detail: `Below ${TWR_COMFORTABLE.toFixed(1)} the vehicle climbs slowly and wastes propellant to gravity.`,
      fix: 'Add thrust or trim propellant.',
    });
  }
  if (
    hasShip &&
    stats.booster.engineCount > 0 &&
    stats.ship.engineCount > 0 &&
    deltaV.totalMs < required
  ) {
    issues.push({
      id: 'delta-v',
      severity: 'critical',
      title: 'Not enough propellant to reach orbit',
      detail: `Estimated Δv ${fmt(deltaV.totalMs)} m/s of ${fmt(required)} m/s needed${crew ? ' (includes crew return reserve)' : ''}.`,
      fix: 'Add booster or ship tank sections.',
      action: { kind: 'select-part', partId: 'ship-tank' },
      actionLabel: 'Select tank',
    });
  }
  const shipWet = stats.ship.dryMassKg + stats.ship.propellantKg;
  if (hasShip && stats.wetMassKg > 0 && shipWet / stats.wetMassKg > SHIP_MASS_SHARE_MAX) {
    issues.push({
      id: 'ship-too-heavy',
      severity: 'warning',
      title: 'Ship too heavy for the booster',
      detail: `The ship is ${Math.round((shipWet / stats.wetMassKg) * 100)}% of liftoff mass; the booster stack is undersized for it.`,
      fix: 'Add booster tanks or shorten the ship stack.',
      action: { kind: 'select-part', partId: 'booster-tank' },
      actionLabel: 'Select tank',
    });
  }

  // ---- Stage compatibility ----
  const stages = instanceStages(bp);
  const vacOnBooster = bp.parts.find(
    (p) => stages.get(p.id) === 'booster' && findPart(p.partId)?.tags.includes('vacuum'),
  );
  if (vacOnBooster) {
    issues.push({
      id: 'vac-on-booster',
      severity: 'warning',
      title: 'Vacuum engine on the booster',
      detail:
        'Vacuum nozzles lose thrust and efficiency at sea level and can be damaged by flow separation.',
      fix: 'Replace booster vacuum engines with sea-level engines.',
      action: { kind: 'select-instance', instanceId: vacOnBooster.id },
      actionLabel: 'Show engine',
    });
  }

  // ---- Recovery ----
  const fins = count('grid-fin');
  const legsOnBooster = bp.parts.filter(
    (p) => p.partId === 'landing-leg' && stages.get(p.id) === 'booster',
  ).length;
  if (fins > 0 && fins < 4) {
    issues.push({
      id: 'grid-fins-asymmetric',
      severity: 'warning',
      title: `Asymmetric grid fins (${fins}/4)`,
      detail: 'An uneven fin set cannot steer the booster predictably.',
      fix: 'Mount all four grid fins or none.',
      action: { kind: 'guide-step', stepId: 'grid-fins' },
      actionLabel: 'Add fins',
    });
  }
  if (fins < 4 || legsOnBooster < 4) {
    issues.push({
      id: 'no-recovery',
      severity: 'warning',
      title: 'Booster is not recoverable',
      detail: `Recovery needs 4 grid fins (${fins}) and 4 landing legs (${legsOnBooster}). Without them the booster is expended.`,
      fix: 'Add grid fins and landing legs to the booster.',
      action: { kind: 'guide-step', stepId: fins < 4 ? 'grid-fins' : 'booster-legs' },
      actionLabel: 'Add hardware',
    });
  }

  // ---- Program constraints ----
  const locked = bp.parts.find((p) => {
    const part = findPart(p.partId);
    return part && !isPartUnlocked(part, ctx.unlockedPartIds);
  });
  if (locked) {
    issues.push({
      id: 'locked-parts',
      severity: 'critical',
      title: 'Uses parts you have not researched',
      detail: `${findPart(locked.partId)?.name ?? locked.partId} is not unlocked in this program.`,
      fix: 'Research the part in the Program panel, or replace it.',
      action: { kind: 'select-instance', instanceId: locked.id },
      actionLabel: 'Show part',
    });
  }
  if (stats.costCredits > ctx.budgetCredits) {
    issues.push({
      id: 'over-budget',
      severity: 'warning',
      title: `New build over budget by ${fmt(stats.costCredits - ctx.budgetCredits)} cr`,
      detail: `A new build costs ${fmt(stats.costCredits)} cr; the program budget is ${fmt(ctx.budgetCredits)} cr per mission. Missions need reflown fleet hardware to fit the budget.`,
      fix: 'Remove parts, recover and refly boosters/ships, or raise the budget through milestones and research.',
      action: { kind: 'open-program' },
      actionLabel: 'Open program',
    });
  }

  return finish(issues, stats, deltaV, required, bp);
}

function finish(
  issues: ReadinessIssue[],
  stats: RocketStats,
  deltaV: DeltaVEstimate,
  requiredDeltaVMs: number,
  bp: RocketBlueprint,
): ReadinessReport {
  const sorted = [...issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
  );
  const criticalCount = sorted.filter((i) => i.severity === 'critical').length;
  const warningCount = sorted.length - criticalCount;
  const has = (id: string) => bp.parts.some((p) => p.partId === id);
  const ids = new Set(sorted.map((i) => i.id));
  return {
    status: criticalCount ? 'blocked' : warningCount ? 'warnings' : 'ready',
    issues: sorted,
    criticalCount,
    warningCount,
    stats,
    deltaV,
    requiredDeltaVMs,
    capabilities: [
      {
        id: 'orbit',
        label: `Reach orbit (Δv ${fmt(deltaV.totalMs)} m/s)`,
        available: deltaV.totalMs >= requiredDeltaVMs && !ids.has('twr-low'),
      },
      {
        id: 'crew',
        label: `Carry crew (${stats.crewCapacity} seats)`,
        available: stats.crewCapacity > 0,
      },
      { id: 'payload', label: 'Carry cargo', available: has('cargo-bay') },
      { id: 'docking', label: 'Dock with a station', available: has('docking-adapter') },
      {
        id: 'booster-recovery',
        label: 'Recover the booster',
        available: stats.partCount > 0 && !ids.has('no-recovery'),
      },
      {
        id: 'ship-reentry',
        label: 'Ship re-entry',
        available: has('ship-aft-section') && !ids.has('heat-shield-gaps') && !ids.has('flaps'),
      },
    ],
  };
}
