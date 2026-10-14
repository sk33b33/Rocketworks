import type { AscentState, AscentTarget } from '../simulation/ascent/ascentModel';
import { isSuccess } from '../simulation/ascent/ascentModel';
import type { Grade } from '../recovery/rating';
import type { RecoveryTarget } from '../recovery/recoveryPlan';

/** What happened on a launch attempt; stored in the save for the debrief and history. */
export interface FlightRecord {
  readonly id: string;
  readonly at: string;
  readonly missionId: string;
  readonly missionName: string;
  readonly designId: string;
  readonly designName: string;
  readonly result: 'success' | 'partial' | 'failure' | 'aborted' | 'scrubbed';
  readonly summary: string;
  /** True when the mission counts as completed (rewards paid on first completion). */
  readonly credited: boolean;
  /** null for uncrewed flights. */
  readonly crewSafe: boolean | null;
  readonly maxAltitudeM: number;
  readonly maxSpeedMS: number;
  readonly maxQPa: number;
  readonly durationS: number;
  readonly events: readonly string[];
  /** Orbital flight and return details (Stage 5+); absent for pad-only flights. */
  readonly landing?: LandingSummary;
  /** Station docking (Stage 7+). */
  readonly docking?: {
    readonly grade: Grade | null;
    readonly manual: boolean;
    readonly bounces: number;
    readonly collisions: number;
    readonly violations: number;
    readonly tasksDone: boolean;
  };
  /** Booster recovery (Stage 6+). */
  readonly recovery?: BoosterRecoverySummary;
  /** Moon missions (Stage 8+). */
  readonly lunar?: LunarSummary;
  /** Fleet vehicles that flew (null = new build). */
  readonly hardware?: { readonly boosterId: string | null; readonly shipId: string | null };
}

export type LunarLandingOutcome = 'landed' | 'tipped' | 'crashed';

export interface LunarSummary {
  /** Closest approach to the Moon (altitude, m). */
  readonly closestAltM: number | null;
  readonly flyby: boolean;
  readonly lunarOrbit: boolean;
  /** Refuelling operations completed (tankers in Earth orbit, the lunar depot). */
  readonly refuels: number;
  readonly landing: {
    readonly siteId: string;
    readonly siteName: string;
    readonly outcome: LunarLandingOutcome;
    readonly grade: Grade | null;
    readonly manual: boolean;
    readonly missM: number;
  } | null;
  readonly surfaceDone: boolean;
  readonly ascent: boolean;
  readonly earthReturn: boolean;
}

export type BoosterOutcome = 'caught' | 'landed' | 'lost' | 'expended' | 'not-attempted';

export interface BoosterRecoverySummary {
  readonly target: RecoveryTarget;
  readonly outcome: BoosterOutcome;
  readonly grade: Grade | null;
  /** The player flew the landing burn. */
  readonly manual: boolean;
  /** The player skipped the replay; the assisted result was simulated. */
  readonly simulated: boolean;
  readonly missM: number | null;
  readonly vertMS: number | null;
  readonly heatLoadMJm2: number;
  readonly summary: string;
}

export type LandingOutcome = 'landed' | 'splashdown' | 'crash' | 'breakup' | 'stranded';

export interface LandingSummary {
  readonly outcome: LandingOutcome;
  /** Zone the ship came down in (within tolerance), if any. */
  readonly zoneName: string | null;
  /** Along-track distance from the selected zone (m, positive = long). */
  readonly missM: number | null;
  readonly shipRecovered: boolean;
  readonly orbits: number;
  readonly hull: number;
  readonly shield: number;
  readonly peakG: number;
  readonly peakHeatKWm2: number;
  /** Precision rating of a landing or splashdown (Stage 6+). */
  readonly grade?: Grade | null;
  /** The player flew the final descent without the landing program. */
  readonly manual?: boolean;
}

/** Missions whose objectives are fully covered by the ascent simulation alone. */
export const CREDITABLE_ON_ASCENT: Readonly<Record<string, AscentTarget['kind']>> = {
  'test-flight': 'suborbital',
};

export interface OutcomeInput {
  readonly id: string;
  readonly at: string;
  readonly missionId: string;
  readonly missionName: string;
  readonly designId: string;
  readonly designName: string;
  readonly crewed: boolean;
}

export function scrubRecord(input: OutcomeInput, reason: string): FlightRecord {
  return {
    ...recordBase(input),
    result: 'scrubbed',
    summary: `Scrubbed: ${reason}`,
    credited: false,
    crewSafe: input.crewed ? true : null,
    maxAltitudeM: 0,
    maxSpeedMS: 0,
    maxQPa: 0,
    durationS: 0,
    events: [],
  };
}

export function recordBase(input: OutcomeInput) {
  return {
    id: input.id,
    at: input.at,
    missionId: input.missionId,
    missionName: input.missionName,
    designId: input.designId,
    designName: input.designName,
  };
}

/** Turns a finished ascent into a flight record. */
export function ascentRecord(input: OutcomeInput, s: AscentState): FlightRecord {
  const success = isSuccess(s.status);
  const creditable = CREDITABLE_ON_ASCENT[input.missionId] !== undefined;
  const result: FlightRecord['result'] = success
    ? creditable
      ? 'success'
      : 'partial'
    : s.status === 'aborted'
      ? 'aborted'
      : 'failure';
  const summaries: Record<string, string> = {
    orbit: creditable
      ? 'Orbit achieved.'
      : 'Ascent to orbit succeeded. Continue the flight in orbit.',
    apogee: 'Suborbital test profile completed: staging, apogee and telemetry return.',
    'low-apogee': 'The ship did not reach the planned apogee.',
    'no-liftoff': 'Hold-down abort at T-0: not enough thrust to lift off.',
    'out-of-propellant': 'Ran out of propellant before reaching the target.',
    crashed: 'The vehicle impacted the ground.',
    lost: 'Vehicle lost during ascent.',
    aborted: 'Flight aborted.',
  };
  return {
    ...recordBase(input),
    result,
    summary: summaries[s.status] ?? s.status,
    credited: success && creditable,
    crewSafe: input.crewed ? s.status !== 'crashed' : null,
    maxAltitudeM: s.maxAltitudeM,
    maxSpeedMS: s.maxSpeedMS,
    maxQPa: s.maxQPa,
    durationS: s.tS,
    events: s.events.map((e) => `T+${Math.round(e.tS)}s ${e.text}`),
  };
}
