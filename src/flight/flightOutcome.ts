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
import type { ContractFlightResult, FlightContract } from '../economy/contracts';

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
  | 'mars-crew-tasks'
  | 'mars-refuel'
  | 'mars-ascent'
  | 'tei'
  | 'mars-return'
  | 'sat-release'
  | 'mars-unload'
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
  /** Satellite contracts: the release (apsides in km, inside the client's tolerance). */
  readonly release?: { readonly apoKm: number; readonly periKm: number; readonly ok: boolean };
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
  'mars-crew-tasks': "Finish the crew's surface tasks",
  'mars-refuel': 'Refuel from the propellant plant',
  'mars-ascent': 'Lift off and reach Mars orbit',
  tei: 'Trans-Earth injection in the return window',
  'mars-return': 'Cruise home to Earth',
  'sat-release': 'Raise the orbit and release the satellite',
  'mars-unload': 'Unload the propellant into the plant',
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
    case 'mars-crew-tasks':
      return !!p.mars?.surfaceDone;
    case 'mars-refuel':
      return (p.mars?.plantDrawKg ?? 0) > 0;
    case 'mars-ascent':
      return !!p.mars?.marsOrbit;
    case 'tei':
      return !!p.mars?.tei;
    case 'mars-return':
      return p.mars?.earthArrivedT !== null && p.mars?.earthArrivedT !== undefined;
    case 'sat-release':
      return !!p.release?.ok;
    case 'mars-unload':
      return (p.mars?.deliveredKg ?? 0) > 0;
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
  /** Contract flights: the client's terms. */
  readonly contract?: FlightContract;
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
  'mars-crewed',
  'contract-satellite',
  'contract-resupply',
  'contract-lunar-depot',
  'contract-mars-tanker',
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
    case 'contract-satellite':
      return ['orbit', 'sat-release', 'deorbit', 'reentry', 'landing'];
    case 'contract-resupply':
      return ['orbit', 'rendezvous', 'dock', 'tasks', 'deorbit', 'reentry', 'landing'];
    case 'contract-lunar-depot':
      return ['orbit', ...leo, 'tli', 'lunar-orbit', 'depot', 'earth-return', 'reentry', 'landing'];
    case 'contract-mars-tanker':
      return ['orbit', ...leo, 'tmi', 'mars-arrival', 'mars-landing', 'mars-unload'];
    case 'mars-crewed':
      return [
        'orbit',
        ...leo,
        'tmi',
        'mars-arrival',
        'mars-landing',
        'mars-crew-tasks',
        'mars-refuel',
        'mars-ascent',
        'tei',
        'mars-return',
        'reentry',
        'landing',
      ];
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
    case 'contract-satellite':
      return !!p.release?.ok;
    case 'contract-resupply':
      return !!p.docking?.grade && !!p.docking.tasksDone;
    case 'contract-lunar-depot':
      return !!l?.refuelDepot && !!l.earthReturn;
    case 'contract-mars-tanker':
      return (p.mars?.deliveredKg ?? 0) > 0;
    case 'mars-crewed': {
      const m = p.mars;
      return (
        !!m &&
        m.landing?.outcome === 'landed' &&
        m.surfaceDone &&
        m.marsOrbit &&
        m.tei &&
        m.earthArrivedT !== null
      );
    }
    default:
      return p.orbit && completedOrbits(p) >= 1;
  }
}

const INCOMPLETE: Record<string, string> = {
  'station-docking': 'dock with the station and finish the docked tasks.',
  'lunar-transfer': 'fly past the Moon and return to Earth orbit.',
  'lunar-landing': 'land on the Moon, finish the surface tasks and fly home.',
  'mars-cargo': 'land on Mars and finish the surface tasks.',
  'mars-crewed': 'land on Mars, finish the surface tasks, and fly the crew home.',
  'contract-satellite': 'release the satellite in the requested orbit.',
  'contract-resupply': 'dock with the station and finish the docked tasks.',
  'contract-lunar-depot': 'unload at the lunar depot and fly home.',
  'contract-mars-tanker': 'land at the plant and unload the propellant.',
};

/** Whether a contract flight met the client's terms (paid if in time; see economy/contracts). */
export function judgeContract(
  c: FlightContract,
  p: FlightProgress,
  m?: MarsSummary,
): ContractFlightResult {
  switch (c.kind) {
    case 'satellite': {
      const r = p.release;
      return {
        contractId: c.id,
        met: !!r?.ok,
        detail: r?.ok
          ? `Satellite released at ${Math.round(r.apoKm)} × ${Math.round(r.periKm)} km (asked: ${c.targetAltKm} ± ${c.toleranceKm} km).`
          : 'The satellite was not released in the requested orbit.',
      };
    }
    case 'resupply': {
      const ok = !!p.docking?.grade && !!p.docking.tasksDone;
      return {
        contractId: c.id,
        met: ok,
        detail: ok
          ? 'Resupply module delivered to the station.'
          : 'The resupply module never reached the station.',
      };
    }
    case 'lunar-depot': {
      const ok = !!p.lunar?.refuelDepot;
      return {
        contractId: c.id,
        met: ok,
        detail: ok
          ? 'Cargo pallet unloaded at the lunar depot.'
          : 'The pallet never reached the depot.',
      };
    }
    case 'mars-tanker': {
      const kg = m?.deliveredKg ?? 0;
      return {
        contractId: c.id,
        met: kg > 0,
        detail:
          kg > 0
            ? `${Math.round(kg / 1000)} t of propellant unloaded into the Mars plant.`
            : 'No propellant reached the Mars plant.',
        ...(kg > 0 ? { deliveredKg: kg } : {}),
      };
    }
  }
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
    ...(ctx.contract ? { contract: judgeContract(ctx.contract, p) } : {}),
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
  if (m.returnTrip) return evaluateMarsRoundTrip(ctx, m, s, p, at);
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
    ...(ctx.contract ? { contract: judgeContract(ctx.contract, p, m) } : {}),
    ...(ctx.recovery ? { recovery: ctx.recovery } : {}),
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
  };
}

/**
 * Crewed round trips end back on Earth: the usual landing rules apply there, and success needs
 * every Mars goal on the way. A flight ended on Mars or in space leaves the crew to be rescued by
 * a later flight (gameplay simplification); a crash or breakup is fatal.
 */
function evaluateMarsRoundTrip(
  ctx: FlightOutcomeContext,
  m: MarsSummary,
  s: FlightState,
  p: FlightProgress,
  at: string,
): FlightRecord {
  const r = m.returnTrip!;
  const onMars = s.touchdown?.body === 'mars' || (s.origin === 'mars' && s.phase !== 'flight');
  const atEarth = !s.origin && s.phase !== 'flight' && !onMars;
  let landing: LandingSummary;
  let summary: string;
  if (atEarth) {
    landing = landingSummary(s, p, ctx.zone, ctx.manualLanding ?? false);
    summary = summarize(landing, ctx.zone);
  } else {
    const outcome: LandingSummary['outcome'] =
      s.phase === 'destroyed' ? 'breakup' : s.phase === 'crashed' ? 'crash' : 'stranded';
    landing = {
      outcome,
      zoneName: null,
      missM: null,
      shipRecovered: false,
      orbits: completedOrbits(p),
      hull: s.hull,
      shield: s.shield,
      peakG: s.peakG,
      peakHeatKWm2: s.peakHeatFluxWm2 / 1000,
      grade: null,
      manual: false,
    };
    const site = m.landing?.siteName ?? 'Mars';
    summary =
      outcome === 'breakup'
        ? r.liftedOff
          ? 'The ship broke up on the way home.'
          : 'The ship broke up during Mars entry.'
        : outcome === 'crash'
          ? r.liftedOff
            ? 'The ship crashed after lifting off from Mars.'
            : 'The ship crashed on Mars.'
          : s.phase === 'tipped'
            ? `The ship tipped over at ${site} and is lost; the crew is assumed rescued by a later flight.`
            : onMars && !r.liftedOff
              ? `Flight ended with the crew on Mars at ${site}; they are assumed rescued by a later flight.`
              : 'Flight ended with the ship still in space; the crew is assumed rescued by a later flight.';
  }
  const safe = landing.outcome === 'landed' || landing.outcome === 'splashdown';
  const goals = orbitalGoalsMet(ctx.outcome.missionId, p);
  const credited = safe && goals && CREDITABLE_IN_FLIGHT.has(ctx.outcome.missionId);
  const result: FlightRecord['result'] =
    landing.outcome === 'stranded'
      ? 'aborted'
      : !safe
        ? 'failure'
        : credited
          ? 'success'
          : 'partial';
  if (credited)
    summary += ` The crew is home after ${Math.round(s.tS / 86_400)} days, ${Math.round(r.surfaceDays ?? 0)} of them on Mars.`;
  else if (safe)
    summary += ` Mission objectives incomplete: ${INCOMPLETE[ctx.outcome.missionId] ?? 'fly the crew home.'}`;
  return {
    ...recordBase({ ...ctx.outcome, at }),
    result,
    summary,
    credited,
    crewSafe: ctx.outcome.crewed
      ? landing.outcome !== 'crash' && landing.outcome !== 'breakup'
      : null,
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
    ...(ctx.contract ? { contract: judgeContract(ctx.contract, p, m) } : {}),
    ...(ctx.recovery ? { recovery: ctx.recovery } : {}),
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
  };
}
