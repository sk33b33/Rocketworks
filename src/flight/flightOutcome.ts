import type {
  BoosterRecoverySummary,
  FlightRecord,
  LandingSummary,
  LunarSummary,
  MarsSummary,
  OutcomeInput,
} from '../launch/flightRecord';
import { rateLanding, type Grade } from '../recovery/rating';
import { recordBase } from '../launch/flightRecord';
import { FLIGHT, type FlightState } from './flightModel';
import { findZoneAt, isLand, missDistanceM, type LandingZone } from './landingZones';
import { localFrame } from './orbitMath';
import type { LunarProgress } from '../moon/lunarFlight';
import type { MarsProgress } from '../mars/marsFlight';

/*
 * Objectives and outcome evaluation for the orbital part of a flight. Pure: the runtime tracks
 * progress flags and calls `evaluateFlight` once the ship is down (or the flight is ended).
 */

export type ObjectiveId =
  | 'orbit'
  | 'lap'
  | 'rendezvous'
  | 'dock'
  | 'tasks'
  | 'refuel'
  | 'tli'
  | 'flyby'
  | 'lunar-orbit'
  | 'depot'
  | 'moon-landing'
  | 'surface'
  | 'moon-ascent'
  | 'earth-return'
  | 'tmi'
  | 'mars-arrival'
  | 'mars-landing'
  | 'mars-surface'
  | 'deorbit'
  | 'reentry'
  | 'landing';

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
  /** Moon missions: lunar objectives. */
  readonly lunar?: LunarProgress;
  /** Mars missions: the voyage and landing. */
  readonly mars?: MarsProgress;
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
  refuel: 'Refuel in low Earth orbit',
  tli: 'Trans-lunar injection',
  flyby: 'Fly past the Moon (photography within 20,000 km)',
  'lunar-orbit': 'Enter lunar orbit',
  depot: 'Top up at the lunar depot',
  'moon-landing': 'Land on the Moon',
  surface: 'Complete the surface tasks',
  'moon-ascent': 'Lift off back to lunar orbit',
  'earth-return': 'Return to Earth orbit (aerocapture)',
  tmi: 'Trans-Mars injection',
  'mars-arrival': 'Cruise to Mars (course corrections)',
  'mars-landing': 'Land at the selected Mars site',
  'mars-surface': 'Unload and start the propellant plant',
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
    case 'refuel':
      return !!(p.lunar?.refuelLeo || p.mars?.refuelLeo);
    case 'tli':
      return !!p.lunar?.tli;
    case 'flyby':
      return !!p.lunar?.flyby;
    case 'lunar-orbit':
      return !!p.lunar?.lunarOrbit;
    case 'depot':
      return !!p.lunar?.refuelDepot;
    case 'moon-landing':
      return p.lunar?.landing?.outcome === 'landed';
    case 'surface':
      return !!p.lunar?.surfaceDone;
    case 'moon-ascent':
      return !!p.lunar?.ascent;
    case 'earth-return':
      return !!p.lunar?.earthReturn;
    case 'tmi':
      return !!p.mars?.tmi;
    case 'mars-arrival':
      return p.mars?.arrivedT !== null && p.mars?.arrivedT !== undefined;
    case 'mars-landing':
      return p.mars?.landing?.outcome === 'landed';
    case 'mars-surface':
      return !!p.mars?.surfaceDone;
    case 'deorbit':
      return p.deorbit;
    case 'reentry':
      return p.reentry;
    case 'landing':
      return (
        (s.phase === 'landed' && s.touchdown?.body === undefined) ||
        (s.phase === 'splashdown' && !isLand(localFrame(s.r).groundAngle))
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
  /** Mars missions: the voyage and landing summary. */
  readonly mars?: MarsSummary;
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
export const CREDITABLE_IN_FLIGHT = new Set([
  'orbital-flight',
  'station-docking',
  'lunar-transfer',
  'lunar-landing',
  'mars-cargo',
]);

/** The objective checklist for a mission's orbital flight. */
export function objectivesFor(
  missionId: string,
  refuel: { readonly leo: boolean; readonly depot: boolean } | null = null,
): ObjectiveId[] {
  const leo: ObjectiveId[] = refuel?.leo ? ['refuel'] : [];
  switch (missionId) {
    case 'station-docking':
      return ['orbit', 'rendezvous', 'dock', 'tasks', 'deorbit', 'reentry', 'landing'];
    case 'lunar-transfer':
      return ['orbit', ...leo, 'tli', 'flyby', 'earth-return', 'deorbit', 'reentry', 'landing'];
    case 'mars-cargo':
      return ['orbit', ...leo, 'tmi', 'mars-arrival', 'mars-landing', 'mars-surface'];
    case 'lunar-landing':
      return [
        'orbit',
        ...leo,
        'tli',
        'lunar-orbit',
        ...(refuel?.depot ? (['depot'] as ObjectiveId[]) : []),
        'moon-landing',
        'surface',
        'moon-ascent',
        'earth-return',
        'reentry',
        'landing',
      ];
    default:
      return ['orbit', 'lap', 'deorbit', 'reentry', 'landing'];
  }
}

/** Mission-specific goals met before the safe return (which is checked separately). */
export function orbitalGoalsMet(missionId: string, p: FlightProgress): boolean {
  const l = p.lunar;
  switch (missionId) {
    case 'station-docking':
      return p.orbit && !!p.docking?.grade && !!p.docking.tasksDone;
    case 'lunar-transfer':
      return !!l && l.tli && l.flyby && l.earthReturn;
    case 'lunar-landing':
      return !!l && l.landing?.outcome === 'landed' && l.surfaceDone && l.ascent && l.earthReturn;
    case 'mars-cargo':
      return p.mars?.landing?.outcome === 'landed' && !!p.mars.surfaceDone;
    default:
      return p.orbit && completedOrbits(p) >= 1;
  }
}

const INCOMPLETE: Record<string, string> = {
  'station-docking': 'dock with the station and finish the docked tasks.',
  'lunar-transfer': 'fly past the Moon and return to Earth orbit.',
  'lunar-landing': 'land on the Moon, finish the surface tasks and fly home.',
  'mars-cargo': 'land on Mars and finish the surface tasks.',
};

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
  const onMoon = s.touchdown?.body === 'moon';
  switch (s.phase) {
    case 'flight':
    case 'tipped':
      // Left in space or on the Moon: the crew is assumed rescued; the ship is not recovered.
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
      if (onMoon) {
        outcome = 'stranded';
        break;
      }
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
  if (ctx.mars) return evaluateMarsFlight(ctx, ctx.mars, s, p, at);
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
  const onMoon = s.touchdown?.body === 'moon';
  if (onMoon)
    summary =
      s.phase === 'crashed'
        ? 'The ship crashed on the Moon.'
        : s.phase === 'tipped'
          ? 'The ship tipped over on the Moon and is lost; the crew is assumed rescued by a later flight.'
          : 'Flight ended with the ship on the Moon; the crew is assumed rescued by a later flight.';
  if (safe && creditable && !objectivesMet)
    summary += ` Mission objectives incomplete: ${INCOMPLETE[ctx.outcome.missionId] ?? 'fly at least one full orbit.'}`;
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
    ...(p.lunar ? { lunar: lunarSummary(p.lunar) } : {}),
    ...(ctx.recovery ? { recovery: ctx.recovery } : {}),
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
  };
}

/** The Moon part of a flight record. */
export function lunarSummary(l: LunarProgress): LunarSummary {
  return {
    closestAltM: l.closestAltM,
    flyby: l.flyby,
    lunarOrbit: l.lunarOrbit,
    refuels: (l.refuelLeo ? 1 : 0) + (l.refuelDepot ? 1 : 0),
    landing: l.landing,
    surfaceDone: l.surfaceDone,
    ascent: l.ascent,
    earthReturn: l.earthReturn,
  };
}

/**
 * Mars cargo flights end on Mars by design: the ship stays as the propellant plant's tanker.
 * Success is a landing at the site with the surface tasks done.
 */
function evaluateMarsFlight(
  ctx: FlightOutcomeContext,
  m: MarsSummary,
  s: FlightState,
  p: FlightProgress,
  at: string,
): FlightRecord {
  const onMars = s.touchdown?.body === 'mars';
  const outcome: LandingSummary['outcome'] =
    s.phase === 'destroyed'
      ? 'breakup'
      : s.phase === 'crashed' || s.phase === 'tipped'
        ? 'crash'
        : s.phase === 'landed' && onMars
          ? 'landed'
          : 'stranded';
  const landing: LandingSummary = {
    outcome,
    zoneName: m.landing?.siteName ?? null,
    missM: m.landing?.missM ?? null,
    shipRecovered: false,
    orbits: completedOrbits(p),
    hull: s.hull,
    shield: s.shield,
    peakG: s.peakG,
    peakHeatKWm2: s.peakHeatFluxWm2 / 1000,
    grade: m.landing?.grade ?? null,
    manual: !!m.landing?.manual,
  };
  const goals = orbitalGoalsMet(ctx.outcome.missionId, p);
  const credited = CREDITABLE_IN_FLIGHT.has(ctx.outcome.missionId) && goals;
  const result: FlightRecord['result'] =
    outcome === 'landed'
      ? credited
        ? 'success'
        : 'partial'
      : outcome === 'stranded'
        ? 'aborted'
        : 'failure';
  const site = m.landing?.siteName ?? 'Mars';
  let summary: string;
  switch (outcome) {
    case 'landed':
      summary = `Landed at ${site}${m.landing?.grade ? ` (rated ${m.landing.grade})` : ''}, ${Math.round(m.landing?.missM ?? 0)} m from the target.`;
      summary += m.plantRunning
        ? ' The propellant plant is running; the ship stays on Mars as its tanker.'
        : m.surfaceDone
          ? ' Cargo delivered; the ship stays on Mars.'
          : ` Mission objectives incomplete: ${INCOMPLETE[ctx.outcome.missionId] ?? 'finish the surface tasks.'}`;
      break;
    case 'crash':
      summary =
        s.phase === 'tipped'
          ? `The ship tipped over on landing at ${site} and is lost.`
          : `The ship crashed on Mars.`;
      break;
    case 'breakup':
      summary = 'The ship broke up during Mars entry.';
      break;
    default:
      summary = m.departed
        ? 'Flight ended with the ship still in space on the way to Mars.'
        : 'Flight ended before leaving Earth orbit.';
  }
  return {
    ...recordBase({ ...ctx.outcome, at }),
    result,
    summary,
    credited,
    crewSafe: ctx.outcome.crewed ? outcome !== 'crash' && outcome !== 'breakup' : null,
    maxAltitudeM: Math.max(ctx.ascent.maxAltitudeM, ctx.maxAltitudeM),
    maxSpeedMS: Math.max(ctx.ascent.maxSpeedMS, ctx.maxSpeedMS),
    maxQPa: ctx.ascent.maxQPa,
    durationS: s.tS,
    events: [
      ...ctx.ascent.events,
      ...s.events.map((e) => `T+${Math.round(e.tS)}s ${e.text}`),
    ].slice(-60),
    landing,
    mars: m,
    ...(ctx.recovery ? { recovery: ctx.recovery } : {}),
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
  };
}
