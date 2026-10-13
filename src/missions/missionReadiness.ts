import { calculateRocketStats } from '../rocket/stats/calculateRocketStats';
import { certificationStatus } from '../rocket/readiness/certification';
import { estimateDeltaV, type DeltaVEstimate } from '../rocket/readiness/deltaV';
import type { ReadinessReport } from '../rocket/readiness/readiness';
import type { RocketBlueprint } from '../rocket/model/types';
import { generateConditions, type LaunchConditions } from './conditions';
import { CREW_MASS_KG, findCrew, ROLE_LABELS, type CrewMember } from './crew';
import {
  findMission,
  findPayload,
  missionAvailability,
  type MissionDefinition,
} from './missionCatalog';
import type { MissionSetup } from './missionSetup';

/*
 * Mission readiness: a deterministic "go/no-go poll" across vehicle, propulsion, crew, life support,
 * guidance, communications, payload and weather. Values are simplified game rules.
 */

export type PollArea =
  'vehicle' | 'propulsion' | 'crew' | 'life-support' | 'guidance' | 'comms' | 'payload' | 'weather';

export const POLL_LABELS: Record<PollArea, string> = {
  vehicle: 'Vehicle',
  propulsion: 'Propulsion / Δv',
  crew: 'Crew',
  'life-support': 'Life support',
  guidance: 'Guidance (RCS)',
  comms: 'Communications',
  payload: 'Payload',
  weather: 'Weather & range',
};

export type MissionTab = 'briefing' | 'manifest' | 'readiness' | 'conditions';

export type MissionFixAction =
  | { readonly kind: 'go-factory'; readonly tab: 'readiness' | 'designs' }
  | { readonly kind: 'wait-window' }
  | { readonly kind: 'open-tab'; readonly tab: MissionTab };

export interface MissionIssue {
  readonly id: string;
  readonly area: PollArea;
  readonly severity: 'critical' | 'warning';
  readonly title: string;
  readonly detail: string;
  readonly fix: string;
  readonly action?: MissionFixAction;
  readonly actionLabel?: string;
}

export type PollStatus = 'go' | 'hold' | 'no-go';

export interface MissionReport {
  readonly mission: MissionDefinition;
  readonly status: 'go' | 'go-with-warnings' | 'no-go';
  readonly issues: readonly MissionIssue[];
  readonly poll: readonly { area: PollArea; status: PollStatus }[];
  readonly deltaV: DeltaVEstimate | null;
  readonly requiredDeltaVMs: number;
  readonly carriedMassKg: number;
  readonly lifeSupport: { requiredCrewDays: number; capacityCrewDays: number };
  readonly conditions: LaunchConditions;
  readonly risk: { score: number; level: 'low' | 'moderate' | 'high'; factors: readonly string[] };
}

export interface MissionContext {
  readonly setup: MissionSetup;
  /** The design named by the setup, if it still exists. */
  readonly blueprint: RocketBlueprint | undefined;
  readonly vehicleReport: ReadinessReport | undefined;
  readonly completedMissionIds: readonly string[];
}

/** Crew-days of life support per part. Game values. */
export const LIFE_SUPPORT_CREW_DAYS: Readonly<Record<string, number>> = {
  'crew-cabin': 60,
  'solar-array': 40,
};
/** Δv margin below which the propulsion poll reports a warning. */
export const DELTA_V_MARGIN_WARN = 0.05;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function evaluateMission(ctx: MissionContext): MissionReport {
  const mission = findMission(ctx.setup.missionId) ?? findMission('test-flight')!;
  const req = mission.requirements;
  const crewed = req.maxCrew > 0;
  const issues: MissionIssue[] = [];
  const add = (issue: MissionIssue) => issues.push(issue);
  const bp = ctx.blueprint;
  const count = (id: string) => bp?.parts.filter((p) => p.partId === id).length ?? 0;
  const crew = ctx.setup.crewIds.map(findCrew).filter((c): c is CrewMember => !!c);
  const payload = findPayload(ctx.setup.payloadId) ?? findPayload('none')!;
  const carriedMassKg = payload.massKg + crew.length * CREW_MASS_KG;
  const conditions = generateConditions(ctx.setup.conditionsSeed);
  const riskFactors: string[] = [];
  let risk = mission.baseRisk;

  const availability = missionAvailability(mission, ctx.completedMissionIds);
  if (!availability.available) {
    add({
      id: 'mission-locked',
      area: 'vehicle',
      severity: 'critical',
      title: 'Mission not yet approved',
      detail: availability.reason,
      fix: 'Pick an available mission.',
    });
  }

  // ---- Vehicle ----
  if (!bp) {
    add({
      id: 'no-design',
      area: 'vehicle',
      severity: 'critical',
      title: 'No vehicle assigned',
      detail: 'Choose a certified design from your library in the Manifest.',
      fix: 'Assign a vehicle.',
      action: { kind: 'open-tab', tab: 'manifest' },
      actionLabel: 'Open manifest',
    });
  } else {
    const cert = certificationStatus(bp);
    if (cert === 'none' || cert === 'expired') {
      add({
        id: 'not-certified',
        area: 'vehicle',
        severity: 'critical',
        title:
          cert === 'expired'
            ? `"${bp.name}" certification expired`
            : `"${bp.name}" is not flight-certified`,
        detail: 'Mission Control only flies designs certified in the factory Readiness tab.',
        fix: 'Certify the design in the Rocket Factory.',
        action: { kind: 'go-factory', tab: 'readiness' },
        actionLabel: 'Go to factory',
      });
    } else if (cert === 'override') {
      add({
        id: 'override-cert',
        area: 'vehicle',
        severity: 'warning',
        title: 'Vehicle certified with tutorial override',
        detail: `${ctx.vehicleReport?.criticalCount ?? 'Some'} critical design issue(s) were waived. The flight may fail.`,
        fix: 'Fix the design and certify it normally.',
        action: { kind: 'go-factory', tab: 'readiness' },
        actionLabel: 'Go to factory',
      });
      risk += 0.15;
      riskFactors.push('Vehicle flown under certification override');
    }
    if (crewed && bp.role !== 'crew') {
      add({
        id: 'role-mismatch',
        area: 'vehicle',
        severity: 'critical',
        title: 'Vehicle is not crew-rated',
        detail: `"${bp.name}" is designed for cargo; crewed missions need a crew-role design.`,
        fix: 'Switch the design role to Crew, fix any new issues and re-certify.',
        action: { kind: 'go-factory', tab: 'readiness' },
        actionLabel: 'Go to factory',
      });
    }
    if (req.reentry && crewed) {
      const vehicleIds = new Set(ctx.vehicleReport?.issues.map((i) => i.id) ?? []);
      if (vehicleIds.has('heat-shield-gaps') || vehicleIds.has('flaps')) {
        add({
          id: 'reentry-hardware',
          area: 'vehicle',
          severity: 'critical',
          title: 'Ship cannot re-enter safely',
          detail:
            'This mission returns crew from orbit: the ship needs full heat shielding and all four flaps.',
          fix: 'Complete heat shield and flaps in the factory.',
          action: { kind: 'go-factory', tab: 'readiness' },
          actionLabel: 'Go to factory',
        });
      }
    }
    if (req.dockingAdapter && count('docking-adapter') === 0) {
      add({
        id: 'docking',
        area: 'vehicle',
        severity: 'critical',
        title: 'No docking adapter',
        detail: 'Station missions must dock; fit a Docking Adapter to the nose.',
        fix: 'Add a Docking Adapter in the factory.',
        action: { kind: 'go-factory', tab: 'designs' },
        actionLabel: 'Go to factory',
      });
    }
    if (req.rcs !== 'none' && count('rcs-block') === 0) {
      add({
        id: 'rcs',
        area: 'guidance',
        severity: req.rcs,
        title: 'No RCS thrusters',
        detail:
          req.rcs === 'critical'
            ? 'Fine attitude control is mandatory for this mission profile.'
            : 'Without RCS the crew must rely on engine gimbal and flaps for attitude control.',
        fix: 'Fit at least one RCS Thruster Block.',
        action: { kind: 'go-factory', tab: 'designs' },
        actionLabel: 'Go to factory',
      });
    }
    if (count('antenna') === 0) {
      add({
        id: 'antenna',
        area: 'comms',
        severity: req.antenna,
        title: 'No communications antenna',
        detail:
          req.antenna === 'critical'
            ? 'Crewed and orbital flights need a voice and telemetry link.'
            : 'Telemetry will rely on low-rate backup links.',
        fix: 'Fit a Comms Antenna.',
        action: { kind: 'go-factory', tab: 'designs' },
        actionLabel: 'Go to factory',
      });
    }
  }

  // ---- Propulsion ----
  const deltaV = bp ? estimateDeltaV(bp, carriedMassKg) : null;
  if (deltaV) {
    const margin = deltaV.totalMs / mission.requiredDeltaVMs - 1;
    if (margin < 0) {
      add({
        id: 'delta-v',
        area: 'propulsion',
        severity: 'critical',
        title: 'Not enough Δv for this mission',
        detail: `Estimated ${fmt(deltaV.totalMs)} m/s with ${fmt(carriedMassKg / 1000)} t carried; ${fmt(mission.requiredDeltaVMs)} m/s needed.`,
        fix: 'Lighten the payload, add tanks or use better engines.',
        action: { kind: 'open-tab', tab: 'manifest' },
        actionLabel: 'Review payload',
      });
    } else if (margin < DELTA_V_MARGIN_WARN) {
      add({
        id: 'delta-v-margin',
        area: 'propulsion',
        severity: 'warning',
        title: `Thin propellant margin (${(margin * 100).toFixed(1)}%)`,
        detail: 'Small dispersions during ascent could leave the ship short.',
        fix: 'Carry less payload or add propellant.',
      });
      risk += 0.1;
      riskFactors.push('Thin Δv margin');
    }
  }

  // ---- Crew ----
  if (!crewed && crew.length > 0) {
    add({
      id: 'crew-on-uncrewed',
      area: 'crew',
      severity: 'critical',
      title: 'Crew assigned to an uncrewed flight',
      detail: 'Remove all crew from the manifest.',
      fix: 'Clear the crew list.',
      action: { kind: 'open-tab', tab: 'manifest' },
      actionLabel: 'Open manifest',
    });
  }
  if (crewed) {
    const seats = bp ? calculateRocketStats(bp).crewCapacity : 0;
    if (crew.length < req.minCrew) {
      add({
        id: 'crew-min',
        area: 'crew',
        severity: 'critical',
        title: `Crew too small (${crew.length}/${req.minCrew} minimum)`,
        detail: 'Assign astronauts in the Manifest.',
        fix: `Assign at least ${req.minCrew} crew.`,
        action: { kind: 'open-tab', tab: 'manifest' },
        actionLabel: 'Assign crew',
      });
    }
    if (crew.length > seats) {
      add({
        id: 'crew-seats',
        area: 'crew',
        severity: 'critical',
        title: `Not enough seats (${crew.length} crew, ${seats} seats)`,
        detail: 'Every crew member needs a seat in a crew cabin.',
        fix: 'Remove crew or add a Crew Cabin.',
        action: { kind: 'open-tab', tab: 'manifest' },
        actionLabel: 'Open manifest',
      });
    }
    for (const role of ['commander', 'pilot'] as const) {
      if (crew.length > 0 && !crew.some((c) => c.role === role)) {
        add({
          id: `crew-${role}`,
          area: 'crew',
          severity: 'critical',
          title: `No ${ROLE_LABELS[role]} assigned`,
          detail: 'Crewed flights need both a Commander and a Pilot.',
          fix: `Assign a ${ROLE_LABELS[role]}.`,
          action: { kind: 'open-tab', tab: 'manifest' },
          actionLabel: 'Assign crew',
        });
      }
    }
    if (
      mission.durationDays >= 6 &&
      crew.length > 0 &&
      !crew.some((c) => c.role === 'flight-engineer')
    ) {
      add({
        id: 'crew-engineer',
        area: 'crew',
        severity: 'warning',
        title: 'No Flight Engineer on a long mission',
        detail: 'In-flight repairs will be slower without an engineer.',
        fix: 'Assign a Flight Engineer.',
        action: { kind: 'open-tab', tab: 'manifest' },
        actionLabel: 'Assign crew',
      });
    }
    for (const c of crew) {
      if (c.status === 'medical-hold') {
        add({
          id: `crew-medical-${c.id}`,
          area: 'crew',
          severity: 'critical',
          title: `${c.name} is on medical hold`,
          detail: c.statusNote ?? 'Not cleared to fly.',
          fix: `Remove ${c.name} from the crew.`,
          action: { kind: 'open-tab', tab: 'manifest' },
          actionLabel: 'Open manifest',
        });
      } else if (c.status === 'fatigued') {
        add({
          id: `crew-fatigue-${c.id}`,
          area: 'crew',
          severity: 'warning',
          title: `${c.name} is fatigued`,
          detail: c.statusNote ?? 'Performance may suffer.',
          fix: 'Consider a rested replacement.',
          action: { kind: 'open-tab', tab: 'manifest' },
          actionLabel: 'Open manifest',
        });
        risk += 0.05;
        riskFactors.push(`${c.name} fatigued`);
      }
    }
    if (crew.length) {
      const avg = crew.reduce((s, c) => s + c.skill, 0) / crew.length;
      risk -= (avg - 3) * 0.05;
      if (avg >= 4) riskFactors.push('Experienced crew (lowers risk)');
      if (avg < 3) riskFactors.push('Inexperienced crew');
    }
  }

  // ---- Life support ----
  const capacity = bp
    ? Object.entries(LIFE_SUPPORT_CREW_DAYS).reduce((s, [id, days]) => s + count(id) * days, 0)
    : 0;
  const requiredCrewDays = crewed ? crew.length * mission.durationDays : 0;
  if (crewed && crew.length > 0 && requiredCrewDays > capacity) {
    add({
      id: 'life-support',
      area: 'life-support',
      severity: 'critical',
      title: 'Insufficient life support',
      detail: `${fmt(requiredCrewDays)} crew-days needed; vehicle supports ${fmt(capacity)}.`,
      fix: 'Fly fewer crew, or add Deployable Solar Arrays (+40 crew-days each).',
      action: { kind: 'open-tab', tab: 'manifest' },
      actionLabel: 'Open manifest',
    });
  }

  // ---- Payload ----
  if (!mission.payloadIds.includes(payload.id)) {
    add({
      id: 'payload-invalid',
      area: 'payload',
      severity: 'critical',
      title: 'Payload not offered for this mission',
      detail: payload.name,
      fix: 'Pick a listed payload.',
      action: { kind: 'open-tab', tab: 'manifest' },
      actionLabel: 'Open manifest',
    });
  } else if (payload.requiresBay && count('cargo-bay') === 0) {
    add({
      id: 'payload-bay',
      area: 'payload',
      severity: 'critical',
      title: `${payload.name} needs a cargo bay`,
      detail: 'This payload deploys through a Cargo Bay Module door.',
      fix: 'Add a Cargo Bay Module, or choose another payload.',
      action: { kind: 'open-tab', tab: 'manifest' },
      actionLabel: 'Change payload',
    });
  }

  // ---- Weather ----
  if (conditions.overall === 'red') {
    const reds = conditions.factors
      .filter((f) => f.status === 'red')
      .map((f) => f.label.toLowerCase());
    add({
      id: 'weather-red',
      area: 'weather',
      severity: 'critical',
      title: 'Weather NO-GO',
      detail: `Launch-commit criteria violated: ${reds.join(', ')}.`,
      fix: 'Stand down and wait for the next launch window.',
      action: { kind: 'wait-window' },
      actionLabel: 'Wait for next window',
    });
  } else if (conditions.overall === 'amber') {
    const ambers = conditions.factors.filter((f) => f.status === 'amber');
    add({
      id: 'weather-amber',
      area: 'weather',
      severity: 'warning',
      title: 'Marginal weather',
      detail: `${ambers.map((f) => f.label).join(', ')} near limits: higher risk.`,
      fix: 'Accept the risk or wait for a better window.',
      action: { kind: 'wait-window' },
      actionLabel: 'Wait for next window',
    });
    risk += 0.1 * ambers.length;
    riskFactors.push(...ambers.map((f) => `Marginal ${f.label.toLowerCase()}`));
  }

  const sorted = [...issues].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
  );
  const areas = Object.keys(POLL_LABELS) as PollArea[];
  const poll = areas.map((area) => {
    const own = sorted.filter((i) => i.area === area);
    const status: PollStatus = own.some((i) => i.severity === 'critical')
      ? 'no-go'
      : own.length
        ? 'hold'
        : 'go';
    return { area, status };
  });
  const critical = sorted.some((i) => i.severity === 'critical');
  const score = Math.min(0.95, Math.max(0.05, risk));
  return {
    mission,
    status: critical ? 'no-go' : sorted.length ? 'go-with-warnings' : 'go',
    issues: sorted,
    poll,
    deltaV,
    requiredDeltaVMs: mission.requiredDeltaVMs,
    carriedMassKg,
    lifeSupport: { requiredCrewDays, capacityCrewDays: capacity },
    conditions,
    risk: {
      score,
      level: score < 0.3 ? 'low' : score < 0.55 ? 'moderate' : 'high',
      factors: riskFactors,
    },
  };
}

export type CommitState = 'planning' | 'committed' | 'void';

/** A commitment stays valid only while the same design revision is assigned and the poll is still go. */
export function commitState(
  setup: MissionSetup,
  bp: RocketBlueprint | undefined,
  report: MissionReport,
): CommitState {
  if (!setup.commit) return 'planning';
  const sameDesign =
    !!bp && setup.commit.designId === bp.id && setup.commit.revision === bp.revision;
  return sameDesign && report.status !== 'no-go' ? 'committed' : 'void';
}

export function commitMission(
  setup: MissionSetup,
  bp: RocketBlueprint | undefined,
  report: MissionReport,
  now: string,
): { ok: true; setup: MissionSetup } | { ok: false; reason: string } {
  if (!bp) return { ok: false, reason: 'Assign a vehicle first.' };
  if (report.status === 'no-go') {
    const n = report.issues.filter((i) => i.severity === 'critical').length;
    return {
      ok: false,
      reason: `Flight director poll is NO-GO: ${n} critical item${n > 1 ? 's' : ''} open.`,
    };
  }
  return {
    ok: true,
    setup: { ...setup, commit: { designId: bp.id, revision: bp.revision, at: now } },
  };
}
