import type { AscentState, AscentTarget } from '../simulation/ascent/ascentModel';
import { isSuccess } from '../simulation/ascent/ascentModel';

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
}

/** Missions whose objectives are fully covered by the ascent simulation in this stage. */
export const CREDITABLE_ON_ASCENT: Readonly<Record<string, AscentTarget['kind']>> = {
  'test-flight': 'suborbital',
  'orbital-flight': 'orbit',
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
    ...base(input),
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

function base(input: OutcomeInput) {
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
      ? 'Orbit achieved. Return and landing are assumed nominal until the flight stage (simplified).'
      : 'Ascent to orbit succeeded. The rest of this mission arrives in a later stage.',
    apogee: 'Suborbital test profile completed: staging, apogee and telemetry return.',
    'low-apogee': 'The ship did not reach the planned apogee.',
    'no-liftoff': 'Hold-down abort at T-0: not enough thrust to lift off.',
    'out-of-propellant': 'Ran out of propellant before reaching the target.',
    crashed: 'The vehicle impacted the ground.',
    lost: 'Vehicle lost during ascent.',
    aborted: 'Flight aborted.',
  };
  return {
    ...base(input),
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
