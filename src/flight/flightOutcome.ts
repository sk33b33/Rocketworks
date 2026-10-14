import type {
  BoosterRecoverySummary,
  FlightRecord,
  LandingSummary,
  OutcomeInput,
} from '../launch/flightRecord';
import { rateLanding, type Grade } from '../recovery/rating';
import { recordBase } from '../launch/flightRecord';
import { FLIGHT, type FlightState } from './flightModel';
import { findZoneAt, isLand, missDistanceM, type LandingZone } from './landingZones';
import { localFrame } from './orbitMath';

/*
 * Objectives and outcome evaluation for the orbital part of a flight. Pure: the runtime tracks
 * progress flags and calls `evaluateFlight` once the ship is down (or the flight is ended).
 */

export type ObjectiveId =
  'orbit' | 'lap' | 'rendezvous' | 'dock' | 'tasks' | 'deorbit' | 'reentry' | 'landing';

export interface FlightProgress {
  /** Stable orbit reached (periapsis ≥ the stable threshold). */
  readonly orbit: boolean;
  /** Unwrapped ground travel since orbit insertion (radians). */
  readonly travelSinceOrbit: number;
  /** Periapsis lowered into the atmosphere after orbit. */
  readonly deorbit: boolean;
  /** Came through peak heating and slowed below the re-entry threshold intact. */
  readonly reentry: boolean;
  /** Reached the hold point near the station (or started proximity operations). */
  readonly rendezvous?: boolean;
  /** Docking with the station (set when the ship departs it). */
  readonly docking?: DockingSummary | null;
}

export interface DockingSummary {
  readonly grade: Grade | null;
  readonly manual: boolean;
  readonly bounces: number;
  readonly collisions: number;
  readonly violations: number;
  readonly tasksDone: boolean;
}

export const NO_PROGRESS: FlightProgress = {
  orbit: false,
  travelSinceOrbit: 0,
  deorbit: false,
  reentry: false,
};

export const LAP_RAD = 2 * Math.PI;

export const OBJECTIVE_LABELS: Record<ObjectiveId, string> = {
  orbit: 'Reach a stable orbit (periapsis ≥ 120 km)',
  lap: 'Complete one full orbit',
  rendezvous: 'Rendezvous: reach the hold point near the station',
  dock: 'Dock with the station',
  tasks: 'Complete the docked tasks, undock and depart',
  deorbit: 'Deorbit burn (periapsis into the atmosphere)',
  reentry: 'Survive re-entry',
  landing: 'Land or splash down safely',
};

export function completedOrbits(p: FlightProgress): number {
  return p.orbit ? Math.max(0, Math.floor(p.travelSinceOrbit / LAP_RAD)) : 0;
}

export function objectiveDone(id: ObjectiveId, p: FlightProgress, s: FlightState): boolean {
  switch (id) {
    case 'orbit':
      return p.orbit;
    case 'lap':
      return completedOrbits(p) >= 1;
    case 'rendezvous':
      return !!p.rendezvous;
    case 'dock':
      return !!p.docking?.grade;
    case 'tasks':
      return !!p.docking?.tasksDone;
    case 'deorbit':
      return p.deorbit;
    case 'reentry':
      return p.reentry;
    case 'landing':
      return (
        s.phase === 'landed' || (s.phase === 'splashdown' && !isLand(localFrame(s.r).groundAngle))
      );
  }
}

export interface FlightOutcomeContext {
  readonly outcome: OutcomeInput;
  /** Selected target zone. */
  readonly zone: LandingZone;
  /** Ascent maxima and log, merged into the record. */
  readonly ascent: {
    readonly maxAltitudeM: number;
    readonly maxSpeedMS: number;
    readonly maxQPa: number;
    readonly events: readonly string[];
  };
  readonly maxAltitudeM: number;
  readonly maxSpeedMS: number;
  /** Booster recovery from the launch, and the fleet hardware that flew. */
  readonly recovery?: BoosterRecoverySummary | null;
  readonly hardware?: { readonly boosterId: string | null; readonly shipId: string | null };
  /** The player flew the final descent without the landing program. */
  readonly manualLanding?: boolean;
}

/** Landing limits used for the ship's precision rating. */
export function shipRatingLimits(zone: LandingZone) {
  return {
    missM: zone.toleranceM,
    vertMS: FLIGHT.touchdownMaxVertMS,
    horizMS: FLIGHT.touchdownMaxHorizMS,
    tiltDeg: FLIGHT.touchdownMaxTiltDeg,
  };
}

/** Missions completed in the orbital flight (plus a safe return). */
export const CREDITABLE_IN_FLIGHT = new Set(['orbital-flight', 'station-docking']);

/** The objective checklist for a mission's orbital flight. */
export function objectivesFor(missionId: string): ObjectiveId[] {
  return missionId === 'station-docking'
    ? ['orbit', 'rendezvous', 'dock', 'tasks', 'deorbit', 'reentry', 'landing']
    : ['orbit', 'lap', 'deorbit', 'reentry', 'landing'];
}

/** Mission-specific goals met in orbit (the safe return is checked separately). */
export function orbitalGoalsMet(missionId: string, p: FlightProgress): boolean {
  if (missionId === 'station-docking')
    return p.orbit && !!p.docking?.grade && !!p.docking.tasksDone;
  return p.orbit && completedOrbits(p) >= 1;
}

/** Classifies how the flight ended. `ended` = the player ended the flight while still flying. */
export function landingSummary(
  s: FlightState,
  p: FlightProgress,
  zone: LandingZone,
  manual = false,
): LandingSummary {
  const angle = localFrame(s.r).groundAngle;
  const at = findZoneAt(angle, zone);
  const land = isLand(angle);
  const solid = land || at?.kind === 'platform' || at?.kind === 'pad';
  let outcome: LandingSummary['outcome'];
  let recovered = false;
  switch (s.phase) {
    case 'flight':
      outcome = 'stranded';
      break;
    case 'destroyed':
      outcome = 'breakup';
      break;
    case 'crashed':
      outcome = 'crash';
      break;
    case 'splashdown':
      // A hard contact is survivable on water only.
      outcome = solid ? 'crash' : 'splashdown';
      break;
    case 'landed':
      outcome = solid ? 'landed' : 'splashdown';
      recovered = solid;
      break;
  }
  return {
    outcome,
    zoneName: s.phase === 'flight' ? null : (at?.name ?? null),
    missM: s.phase === 'flight' ? null : missDistanceM(angle, zone),
    shipRecovered: recovered,
    orbits: completedOrbits(p),
    hull: s.hull,
    shield: s.shield,
    peakG: s.peakG,
    peakHeatKWm2: s.peakHeatFluxWm2 / 1000,
    grade:
      outcome === 'landed' && s.touchdown
        ? rateLanding(
            { ...s.touchdown, missM: missDistanceM(angle, at ?? zone) },
            shipRatingLimits(at ?? zone),
          ).grade
        : null,
    manual: manual && (outcome === 'landed' || outcome === 'splashdown'),
  };
}

function summarize(l: LandingSummary, zone: LandingZone): string {
  const miss =
    l.missM === null
      ? ''
      : ` (${(Math.abs(l.missM) / 1000).toFixed(1)} km ${l.missM >= 0 ? 'long' : 'short'} of ${zone.name})`;
  switch (l.outcome) {
    case 'landed':
      return l.zoneName
        ? `Landed on ${l.zoneName}. Ship recovered.`
        : `Landed safely off target on the coast${miss}. Ship recovered.`;
    case 'splashdown':
      return l.zoneName
        ? `Splashdown in the ${l.zoneName}. The ship is not recovered.`
        : `Splashdown in open ocean${miss}. The ship is not recovered.`;
    case 'crash':
      return `The ship hit the surface too hard${miss}.`;
    case 'breakup':
      return 'The ship broke up during re-entry.';
    case 'stranded':
      return 'Flight ended with the ship still in space; it was not recovered.';
  }
}

/** Builds the flight record for an orbital flight that has ended. */
export function evaluateFlight(
  ctx: FlightOutcomeContext,
  s: FlightState,
  p: FlightProgress,
  at: string,
): FlightRecord {
  const landing = landingSummary(s, p, ctx.zone, ctx.manualLanding ?? false);
  const safe = landing.outcome === 'landed' || landing.outcome === 'splashdown';
  const creditable = CREDITABLE_IN_FLIGHT.has(ctx.outcome.missionId);
  const objectivesMet = orbitalGoalsMet(ctx.outcome.missionId, p) && safe;
  const credited = creditable && objectivesMet;
  const result: FlightRecord['result'] =
    landing.outcome === 'stranded'
      ? 'aborted'
      : !safe
        ? 'failure'
        : credited
          ? 'success'
          : 'partial';
  let summary = summarize(landing, ctx.zone);
  if (safe && creditable && !objectivesMet)
    summary +=
      ctx.outcome.missionId === 'station-docking'
        ? ' Mission objectives incomplete: dock with the station and finish the docked tasks.'
        : ' Mission objectives incomplete: fly at least one full orbit.';
  if (safe && !creditable) summary += ' The rest of this mission arrives in a later stage.';
  // A stranded crew is assumed rescued (gameplay simplification); breakup or a crash is fatal.
  const crewSafe = ctx.outcome.crewed
    ? landing.outcome !== 'crash' && landing.outcome !== 'breakup'
    : null;
  return {
    ...recordBase({ ...ctx.outcome, at }),
    result,
    summary,
    credited,
    crewSafe,
    maxAltitudeM: Math.max(ctx.ascent.maxAltitudeM, ctx.maxAltitudeM),
    maxSpeedMS: Math.max(ctx.ascent.maxSpeedMS, ctx.maxSpeedMS),
    maxQPa: ctx.ascent.maxQPa,
    durationS: s.tS,
    events: [
      ...ctx.ascent.events,
      ...s.events.map((e) => `T+${Math.round(e.tS)}s ${e.text}`),
    ].slice(-60),
    landing,
    ...(p.docking ? { docking: p.docking } : {}),
    ...(ctx.recovery ? { recovery: ctx.recovery } : {}),
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
  };
}
