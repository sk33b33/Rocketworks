import { EARTH_MU_M3S2, G0_MS2 } from '../simulation/constants';
import type { FlightControls, FlightEvent, FlightState, ShipSpec } from '../flight/flightModel';
import { flightPathAngleDeg } from '../flight/flightModel';
import { orbitalElements, type OrbitalElements, type Vec2 } from '../flight/orbitMath';
import type { MarsSummary } from '../launch/flightRecord';
import { REFUEL, type RefuelOp } from '../moon/lunarFlight';
import type { SiteTerrain } from '../moon/lunarSites';
import { rateLanding } from '../recovery/rating';
import { excessSpeed, outgoingAsymptote, propagateKepler, type KeplerState } from './kepler';
import {
  approachMetric,
  cruiseMetric,
  predictArrival,
  solveImpulse,
  timeToRadius,
} from './marsCruise';
import { earthEnergy, planTmi, tmiBurnControls } from './marsDeparture';
import {
  ENTRY_START,
  lockSiteAngle,
  MANUAL_MARS_ALT_M,
  marsGeometry,
  runMarsDescent,
  type MarsGeometry,
  type MarsLanding,
} from './marsEntry';
import {
  marsFrame,
  marsRatingLimits,
  marsSlewRate,
  stepMarsFlight,
  type MarsGround,
} from './marsModel';
import { marsSurfaceProgress, marsSurfaceTasks, type MarsTask } from './marsRules';
import {
  DEFAULT_MARS_SITE_ID,
  findMarsSite,
  MARS_SITES,
  marsTerrain,
  type MarsSite,
} from './marsSites';
import {
  DAY_S,
  EARTH_SOI_M,
  MARS_BODY,
  MARS_MU_M3S2,
  MARS_RADIUS_M,
  MARS_SOI_M,
  planetState,
  programTime,
  SUN_MU_M3S2,
  type PlanetState,
} from './solarSystem';

/*
 * Everything a Mars mission adds to a flight, owned by the flight runtime (like the Moon's
 * LunarFlight): orbital refuelling, trans-Mars injection, the voyage (Sun-centred cruise with
 * course corrections, then the Mars-centred approach) on analytic conics so it can run at very
 * high time warp, entry and landing on fixed steps, the landing site, and the surface tasks.
 * Framework-free and deterministic.
 */

export interface MarsMissionPlan {
  /** Program day of the launch (the flight clock adds to it). */
  readonly launchDay: number;
  /** Tankers fill the ship in low Earth orbit before injection. */
  readonly refuelLeo: boolean;
  /** Carries the propellant plant as cargo. */
  readonly plant: boolean;
}

export type MarsProgramId = 'trans-mars' | 'mars-cruise' | 'mars-entry';

export const MARS_PROGRAM_LABELS: Record<MarsProgramId, string> = {
  'trans-mars': 'Trans-Mars injection',
  'mars-cruise': 'Cruise navigation',
  'mars-entry': 'Mars entry and landing',
};

const MARS_PROGRAMS: readonly string[] = ['trans-mars', 'mars-cruise', 'mars-entry'];
export const isMarsProgram = (p: string): p is MarsProgramId => MARS_PROGRAMS.includes(p);

export type MarsPhase =
  'plan' | 'wait' | 'burn' | 'depart' | 'cruise' | 'approach' | 'descent' | 'done';

export const MARS_PHASE_LABELS: Record<MarsPhase, string> = {
  plan: 'Planning',
  wait: 'Waiting for the injection burn',
  burn: 'Injection burn',
  depart: 'Leaving Earth',
  cruise: 'Cruising to Mars',
  approach: 'Approaching Mars',
  descent: 'Entry and landing',
  done: 'Complete',
};

export interface TmiInfo {
  readonly burnStartT: number;
  readonly targetEnergy: number;
  readonly dvMS: number;
  /** Planned arrival (flight clock) and flight time. */
  readonly arrivalT: number;
  readonly tofS: number;
  readonly vInfArrMS: number;
}

export interface MarsGuidance {
  readonly program: MarsProgramId | 'none';
  readonly phase: MarsPhase;
  readonly tmi: TmiInfo | null;
  /** Next cruise correction (flight clock), and how many more are planned after it. */
  readonly mccT: number | null;
  readonly mccLeft: number;
  /** Approach correction time inside Mars's sphere of influence. */
  readonly approachT: number | null;
  readonly descent: MarsLanding | null;
}

export const MARS_IDLE: MarsGuidance = {
  program: 'none',
  phase: 'plan',
  tmi: null,
  mccT: null,
  mccLeft: 0,
  approachT: null,
  descent: null,
};

export interface MarsProgress {
  readonly refuelLeo: boolean;
  readonly tmi: boolean;
  /** Left Earth's sphere of influence (flight clock). */
  readonly departedT: number | null;
  readonly corrections: number;
  readonly correctionDvMS: number;
  /** Entered Mars's sphere of influence (flight clock). */
  readonly arrivedT: number | null;
  readonly siteLocked: boolean;
  readonly entry: boolean;
  readonly entrySpeedMS: number | null;
  readonly landing: MarsSummary['landing'];
  readonly landedT: number | null;
  readonly surfaceDone: boolean;
}

export const NO_MARS_PROGRESS: MarsProgress = {
  refuelLeo: false,
  tmi: false,
  departedT: null,
  corrections: 0,
  correctionDvMS: 0,
  arrivedT: null,
  siteLocked: false,
  entry: false,
  entrySpeedMS: null,
  landing: null,
  landedT: null,
  surfaceDone: false,
};

export interface MarsSurfaceView {
  readonly startT: number;
  readonly elapsedS: number;
  readonly tasks: readonly MarsTask[];
  readonly progress: readonly number[];
  readonly done: boolean;
}

/** Arrival prediction for the HUD (flight clock times). */
export interface ArrivalView {
  readonly closestT: number;
  /** Aim error of the approach (km; 0 = on the entry corridor). */
  readonly aimErrorKm: number;
  readonly vInfMS: number;
}

export interface MarsView {
  readonly plan: MarsMissionPlan;
  readonly guidance: MarsGuidance;
  readonly progress: MarsProgress;
  /** Program time and day for the current flight clock. */
  readonly programT: number;
  readonly day: number;
  /** Which body the ship's state refers to. */
  readonly frame: 'earth' | 'sun' | 'mars';
  /** Heliocentric positions for the system map. */
  readonly earth: PlanetState;
  readonly mars: PlanetState;
  readonly shipHelio: Vec2;
  /** Predicted heliocentric path (for the map), sampled ahead. */
  readonly path: readonly Vec2[];
  readonly arrival: ArrivalView | null;
  /** Altitude and speed relative to Mars (null while far away). */
  readonly marsAltitudeM: number | null;
  readonly marsSpeedMS: number | null;
  readonly marsElements: OrbitalElements | null;
  readonly site: MarsSite;
  readonly terrain: SiteTerrain<MarsSite>;
  readonly siteAngle: number | null;
  readonly canChangeSite: boolean;
  readonly geometry: MarsGeometry | null;
  readonly descent: MarsLanding | null;
  readonly surface: MarsSurfaceView | null;
  readonly refuel: RefuelOp | null;
  readonly refuelAvailable: { readonly ok: boolean; readonly reason?: string };
  /** Manual flying is possible (entry and landing only). */
  readonly manualAllowed: boolean;
  /** Whether each Mars program can be engaged now. */
  readonly programs: Record<MarsProgramId, { readonly ok: boolean; readonly reason?: string }>;
}

/** Everything needed to resume the Mars part of a flight (plain data). */
export interface MarsSnapshot {
  readonly plan: MarsMissionPlan;
  readonly siteId: string;
  readonly siteAngle: number | null;
  readonly g: MarsGuidance;
  readonly p: MarsProgress;
  readonly op: RefuelOp | null;
  readonly surface: { startT: number; tasks: MarsTask[] } | null;
  readonly surfaceElapsed: number;
  readonly manualLow: boolean;
  readonly assistedLow: boolean;
}

export interface VoyageStep {
  readonly state: FlightState;
  /** Simulated seconds used (0 = nothing to do with this budget). */
  readonly used: number;
  readonly notes: readonly FlightEvent[];
  readonly message?: string;
  /** Something happened the player should see at normal speed. */
  readonly slowDown?: boolean;
}

/** Below this altitude near Mars the ship is flown on fixed steps (entry, landing). */
export const MARS_NUMERIC_ALT_M = 140_000;
const FINE_DT_S = 0.05;
const MCC_FIRST_AFTER_S = 3 * DAY_S;
const MCC_BEFORE_ARRIVAL_S = [50 * DAY_S, 8 * DAY_S];
const APPROACH_DELAY_S = 2 * 3_600;
const PATH_REFRESH_S = 2 * DAY_S;

export class MarsFlight {
  private g: MarsGuidance = MARS_IDLE;
  private p: MarsProgress = NO_MARS_PROGRESS;
  private op: RefuelOp | null = null;
  private siteNow: MarsSite;
  private terrainNow: SiteTerrain<MarsSite>;
  private siteAngle: number | null = null;
  private surface: { startT: number; tasks: MarsTask[] } | null = null;
  private surfaceElapsed = 0;
  private manualLow = false;
  private assistedLow = false;
  private path: Vec2[] = [];
  private pathT = -Infinity;
  private pathProp = -1;
  private arrivalCache: { at: number; prop: number; view: ArrivalView | null } | null = null;

  constructor(readonly plan: MarsMissionPlan) {
    this.siteNow = findMarsSite(DEFAULT_MARS_SITE_ID) ?? MARS_SITES[0]!;
    this.terrainNow = marsTerrain(this.siteNow);
  }

  // ---- snapshot ----

  snapshot(): MarsSnapshot {
    return {
      plan: this.plan,
      siteId: this.siteNow.id,
      siteAngle: this.siteAngle,
      g: this.g,
      p: this.p,
      op: this.op,
      surface: this.surface,
      surfaceElapsed: this.surfaceElapsed,
      manualLow: this.manualLow,
      assistedLow: this.assistedLow,
    };
  }

  static fromSnapshot(snap: MarsSnapshot): MarsFlight {
    const f = new MarsFlight(snap.plan);
    const site = findMarsSite(snap.siteId);
    if (site) {
      f.siteNow = site;
      f.terrainNow = marsTerrain(site);
    }
    f.siteAngle = snap.siteAngle;
    f.g = snap.g;
    f.p = { ...NO_MARS_PROGRESS, ...snap.p };
    f.op = snap.op;
    f.surface = snap.surface;
    f.surfaceElapsed = snap.surfaceElapsed;
    f.manualLow = snap.manualLow;
    f.assistedLow = snap.assistedLow;
    return f;
  }

  // ---- accessors ----

  get guidance(): MarsGuidance {
    return this.g;
  }
  get progress(): MarsProgress {
    return this.p;
  }
  get refuelling(): RefuelOp | null {
    return this.op;
  }
  get site(): MarsSite {
    return this.siteNow;
  }
  get ground(): MarsGround {
    return { site: this.siteNow, terrain: this.terrainNow, siteAngle: this.siteAngle };
  }
  get onSurface(): boolean {
    return this.surface !== null;
  }
  /** Program time for a flight-clock reading. */
  programT(tS: number): number {
    return programTime(this.plan.launchDay, tS);
  }

  get canChangeSite(): boolean {
    return !this.p.siteLocked && !this.p.landing;
  }

  setSite(id: string): boolean {
    const site = findMarsSite(id);
    if (!site || !this.canChangeSite) return false;
    this.siteNow = site;
    this.terrainNow = marsTerrain(site);
    return true;
  }

  /** Manual flying is offered for entry and landing (near Mars, low), not the cruise. */
  manualAllowed(s: FlightState): boolean {
    return (
      s.origin === 'mars' && s.phase === 'flight' && marsFrame(s.r).altitudeM < MARS_NUMERIC_ALT_M
    );
  }

  // ---- programs ----

  availability(program: MarsProgramId, s: FlightState): { ok: boolean; reason?: string } {
    if (s.phase !== 'flight') return { ok: false, reason: 'The ship is down.' };
    switch (program) {
      case 'trans-mars': {
        if (s.origin) return { ok: false, reason: 'Already on the way to Mars.' };
        if (this.p.tmi) return { ok: false, reason: 'Trans-Mars injection is done.' };
        if (this.op) return { ok: false, reason: 'Refuelling in progress: wait for it to finish.' };
        const el = orbitalElements(s.r, s.v);
        if (el.status !== 'orbit')
          return { ok: false, reason: 'Reach a stable parking orbit first.' };
        if (s.propKg <= 0) return { ok: false, reason: 'No propellant for the injection burn.' };
        return { ok: true };
      }
      case 'mars-cruise':
        return s.origin === 'sun'
          ? { ok: true }
          : { ok: false, reason: 'Cruise navigation runs between Earth and Mars.' };
      case 'mars-entry':
        if (s.origin !== 'mars')
          return { ok: false, reason: 'Entry guidance takes over near Mars.' };
        return { ok: true };
    }
  }

  startProgram(program: MarsProgramId, s: FlightState): void {
    if (program === 'trans-mars') this.g = { ...MARS_IDLE, program, phase: 'plan' };
    else if (program === 'mars-cruise') this.g = { ...this.g, program, phase: 'cruise' };
    else {
      const low = marsFrame(s.r).altitudeM < MARS_NUMERIC_ALT_M;
      this.g = {
        ...this.g,
        program,
        phase: low ? 'descent' : 'approach',
        descent: low ? (this.g.descent ?? this.resumeDescent(s)) : this.g.descent,
      };
    }
  }

  /** Re-engaging after a manual takeover: pick the descent phase that fits the state. */
  private resumeDescent(s: FlightState): MarsLanding {
    const geo = marsGeometry(s, this.ground);
    if (geo.speed > 650 && geo.radarM > 15_000) return ENTRY_START;
    return { ...ENTRY_START, phase: 'flip' };
  }

  stopProgram(): void {
    // Cruise navigation keeps its schedule; only the active steering stops.
    this.g = { ...this.g, program: 'none' };
  }

  // ---- Earth phase: refuelling and injection ----

  refuelAvailability(s: FlightState): { ok: boolean; reason?: string } {
    if (this.op) return { ok: false, reason: 'Refuelling in progress.' };
    if (s.phase !== 'flight' || s.origin) return { ok: false, reason: 'Only in Earth orbit.' };
    if (!this.plan.refuelLeo)
      return { ok: false, reason: 'No orbital refuelling was bought for this mission.' };
    if (this.p.refuelLeo) return { ok: false, reason: 'The tanker flights are used.' };
    if (this.p.tmi) return { ok: false, reason: 'Already injected toward Mars.' };
    const el = orbitalElements(s.r, s.v);
    if (el.status !== 'orbit' || el.apoapsisAltM > 1_000_000)
      return { ok: false, reason: 'Needs a stable low Earth orbit to meet the tankers.' };
    return { ok: true };
  }

  startRefuel(s: FlightState): { ok: boolean; reason?: string } {
    const a = this.refuelAvailability(s);
    if (!a.ok) return a;
    this.op = {
      kind: 'leo',
      startT: s.tS,
      endT: s.tS + REFUEL.leoDurationS,
      fromKg: s.propKg,
    };
    return { ok: true };
  }

  applyRefuel(s: FlightState, spec: ShipSpec): { state: FlightState; done?: string } {
    const op = this.op;
    if (!op) return { state: s };
    const cap = spec.stage.propellantKg;
    const f = Math.min(1, (s.tS - op.startT) / (op.endT - op.startT));
    const propKg = Math.max(s.propKg, op.fromKg + (cap - op.fromKg) * f);
    if (f < 1) return { state: { ...s, propKg } };
    this.op = null;
    this.p = { ...this.p, refuelLeo: true };
    return {
      state: { ...s, propKg: cap },
      done: `Refuelled in orbit: tanks full (${Math.round(cap / 1000)} t).`,
    };
  }

  /** Runs trans-Mars injection in the Earth-centred flight. */
  runEarth(
    s: FlightState,
    spec: ShipSpec,
  ): { controls: FlightControls; message?: string; done?: boolean } {
    const g = this.g;
    const hold = tmiBurnControls(s, false);
    if (g.program !== 'trans-mars') return { controls: hold };
    switch (g.phase) {
      case 'plan': {
        const plan = planTmi(s, spec, this.plan.launchDay);
        if (!plan) {
          this.g = MARS_IDLE;
          return {
            controls: hold,
            message: "Couldn't plan trans-Mars injection: check the orbit.",
            done: true,
          };
        }
        const arrivalT = plan.transfer.arrivalT - this.plan.launchDay * DAY_S;
        this.g = {
          ...g,
          phase: 'wait',
          tmi: {
            burnStartT: plan.burnStartT,
            targetEnergy: plan.targetEnergy,
            dvMS: plan.dvMS,
            arrivalT,
            tofS: plan.transfer.tofS,
            vInfArrMS: plan.transfer.vInfArrMS,
          },
        };
        return {
          controls: hold,
          message: `Trans-Mars injection planned: ${Math.round(plan.dvMS)} m/s, arriving in ${Math.round(plan.transfer.tofS / DAY_S)} days.`,
        };
      }
      case 'wait': {
        if (g.tmi && s.tS >= g.tmi.burnStartT) {
          if (s.tS > g.tmi.burnStartT + 60) {
            // Missed (e.g. paused through it): plan again.
            this.g = { ...g, phase: 'plan' };
            return { controls: hold };
          }
          this.g = { ...g, phase: 'burn' };
          return { controls: tmiBurnControls(s, true), message: 'Trans-Mars injection burn.' };
        }
        return { controls: hold };
      }
      case 'burn': {
        if ((g.tmi && earthEnergy(s.r, s.v) >= g.tmi.targetEnergy) || s.propKg <= 0) {
          this.g = { ...g, phase: 'depart' };
          this.p = { ...this.p, tmi: true };
          return {
            controls: hold,
            message:
              s.propKg <= 0
                ? 'Propellant depleted during the injection burn.'
                : 'Trans-Mars injection complete: leaving Earth.',
          };
        }
        return { controls: tmiBurnControls(s, true) };
      }
      default:
        return { controls: hold };
    }
  }

  /** The ship has left Earth's sphere of influence on its way out. */
  readyForVoyage(s: FlightState): boolean {
    return (
      !s.origin &&
      this.p.tmi &&
      s.phase === 'flight' &&
      Math.hypot(s.r[0], s.r[1]) >= EARTH_SOI_M &&
      orbitalElements(s.r, s.v).status === 'escape'
    );
  }

  /** Converts the ship to the Sun-centred frame and starts cruise navigation. */
  enterVoyage(s: FlightState): FlightState {
    const e = planetState('earth', this.programT(s.tS));
    // Patched conics: leave with the hyperbolic excess velocity along the departure asymptote
    // (at the sphere's edge the path is still turning toward it).
    const vInf = excessSpeed(s.r, s.v, EARTH_MU_M3S2);
    const dir = outgoingAsymptote(s.r, s.v, EARTH_MU_M3S2) ?? [0, 0];
    const next: FlightState = {
      ...s,
      origin: 'sun',
      r: [s.r[0] + e.r[0], s.r[1] + e.r[1]],
      v: [dir[0] * vInf + e.v[0], dir[1] * vInf + e.v[1]],
      throttle: 0,
    };
    this.p = { ...this.p, departedT: s.tS };
    this.g = {
      ...this.g,
      program: 'mars-cruise',
      phase: 'cruise',
      mccT: s.tS + MCC_FIRST_AFTER_S,
      mccLeft: 3,
    };
    return next;
  }

  // ---- voyage ----

  /** Advances the voyage by at most `budget` simulated seconds. */
  voyageStep(
    s: FlightState,
    spec: ShipSpec,
    budget: number,
    manual: FlightControls | null,
  ): VoyageStep {
    if (s.phase !== 'flight') return { state: s, used: 0, notes: [] };
    if (s.origin === 'sun') return this.cruiseStep(s, spec, budget);
    if (s.origin !== 'mars') return { state: s, used: 0, notes: [] };
    const f = marsFrame(s.r);
    const numeric =
      f.altitudeM < MARS_NUMERIC_ALT_M ||
      s.throttle > 0 ||
      (manual !== null && manual.throttle > 0);
    if (!numeric) return this.approachStep(s, spec, budget);
    if (budget < FINE_DT_S) return { state: s, used: 0, notes: [] };
    return this.descentStep(s, spec, manual);
  }

  private consume(s: FlightState, spec: ShipSpec, dv: Vec2): FlightState {
    const size = Math.hypot(dv[0], dv[1]);
    const m0 = spec.stage.dryMassKg + s.propKg;
    const ve = spec.stage.ispVacS * G0_MS2;
    const used = Math.min(s.propKg, m0 * (1 - Math.exp(-size / ve)));
    return { ...s, v: [s.v[0] + dv[0], s.v[1] + dv[1]], propKg: s.propKg - used };
  }

  private cruiseStep(s: FlightState, spec: ShipSpec, budget: number): VoyageStep {
    const g = this.g;
    let dt = Math.min(budget, DAY_S);
    if (g.mccT !== null) dt = Math.min(dt, Math.max(0, g.mccT - s.tS));
    const notes: FlightEvent[] = [];
    let message: string | undefined;
    let slowDown = false;
    const T0 = this.programT(s.tS);
    const k0: KeplerState = { r: s.r, v: s.v };
    let k = dt > 0 ? propagateKepler(k0, SUN_MU_M3S2, dt) : k0;
    let t = s.tS + dt;
    const distMars = (ks: KeplerState, T: number) => {
      const m = planetState('mars', T);
      return Math.hypot(ks.r[0] - m.r[0], ks.r[1] - m.r[1]);
    };
    // Entering Mars's sphere of influence: find the crossing and switch frames.
    if (dt > 0 && distMars(k, T0 + dt) < MARS_SOI_M) {
      let a = 0;
      let b = dt;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        if (distMars(propagateKepler(k0, SUN_MU_M3S2, m), T0 + m) > MARS_SOI_M) a = m;
        else b = m;
      }
      k = propagateKepler(k0, SUN_MU_M3S2, b);
      t = s.tS + b;
      const m = planetState('mars', this.programT(t));
      const rel: FlightState = {
        ...s,
        tS: t,
        origin: 'mars',
        r: [k.r[0] - m.r[0], k.r[1] - m.r[1]],
        v: [k.v[0] - m.v[0], k.v[1] - m.v[1]],
      };
      this.p = { ...this.p, arrivedT: t };
      this.g = {
        ...g,
        program: 'mars-entry',
        phase: 'approach',
        mccT: null,
        mccLeft: 0,
        approachT: t + APPROACH_DELAY_S,
      };
      const days = this.p.departedT !== null ? (t - this.p.departedT) / DAY_S : null;
      const text = `Entered Mars's sphere of influence${days !== null ? ` after ${Math.round(days)} days` : ''}.`;
      notes.push({ tS: t, kind: 'success', text });
      return {
        state: { ...rel, pitchDeg: flightPathAngleDeg(rel.r, rel.v) },
        used: b,
        notes,
        message: text,
        slowDown: true,
      };
    }
    let state: FlightState = { ...s, tS: t, r: k.r, v: k.v };
    // A cruise correction falls due.
    if (g.mccT !== null && t >= g.mccT - 1e-6) {
      const T = this.programT(t);
      const dv = solveImpulse({ r: state.r, v: state.v }, (ks) => cruiseMetric(ks, T), 20_000);
      const left = g.mccLeft - 1;
      const arrival = predictArrival({ r: state.r, v: state.v }, T);
      const nextT = this.nextCorrectionT(
        t,
        left,
        arrival ? arrival.closestT - this.plan.launchDay * DAY_S : null,
      );
      this.g = { ...g, mccT: nextT, mccLeft: Math.max(0, left) };
      const n = this.p.corrections + 1;
      if (!dv) {
        message = 'No course correction found: holding the current trajectory.';
      } else {
        const size = Math.hypot(dv[0], dv[1]);
        if (size < 0.3) {
          message = `Course check ${n}: on course, no correction needed.`;
        } else {
          state = this.consume(state, spec, dv);
          this.p = {
            ...this.p,
            corrections: n,
            correctionDvMS: this.p.correctionDvMS + size,
          };
          message = `Course correction ${n}: ${size.toFixed(1)} m/s.`;
          notes.push({ tS: t, kind: 'info', text: message });
        }
      }
      this.arrivalCache = null;
      this.pathT = -Infinity;
    }
    return {
      state,
      used: dt,
      notes,
      ...(message ? { message } : {}),
      ...(slowDown ? { slowDown } : {}),
    };
  }

  private nextCorrectionT(now: number, left: number, arrivalT: number | null): number | null {
    if (left <= 0 || arrivalT === null) return null;
    for (const before of MCC_BEFORE_ARRIVAL_S) {
      const t = arrivalT - before;
      if (t > now + DAY_S) return t;
    }
    return null;
  }

  private approachStep(s: FlightState, spec: ShipSpec, budget: number): VoyageStep {
    const g = this.g;
    const notes: FlightEvent[] = [];
    let message: string | undefined;
    const k0: KeplerState = { r: s.r, v: s.v };
    const toLow = timeToRadius(k0, MARS_RADIUS_M + MARS_NUMERIC_ALT_M);
    let dt = Math.min(budget, DAY_S);
    if (toLow !== null) dt = Math.min(dt, toLow);
    if (g.approachT !== null) dt = Math.min(dt, Math.max(0, g.approachT - s.tS));
    let k = dt > 0 ? propagateKepler(k0, MARS_MU_M3S2, dt) : k0;
    const t = s.tS + dt;
    // Left Mars behind (missed): back to the Sun-centred frame.
    if (Math.hypot(k.r[0], k.r[1]) > MARS_SOI_M && k.r[0] * k.v[0] + k.r[1] * k.v[1] > 0) {
      const m = planetState('mars', this.programT(t));
      return {
        state: {
          ...s,
          tS: t,
          origin: 'sun',
          r: [k.r[0] + m.r[0], k.r[1] + m.r[1]],
          v: [k.v[0] + m.v[0], k.v[1] + m.v[1]],
        },
        used: dt,
        notes: [
          { tS: t, kind: 'fail', text: 'The ship missed Mars and is coasting on around the Sun.' },
        ],
        message: 'The ship missed Mars.',
        slowDown: true,
      };
    }
    let state: FlightState = { ...s, tS: t, r: k.r, v: k.v };
    if (g.approachT !== null && t >= g.approachT - 1e-6) {
      const dv = solveImpulse(k, approachMetric, 200, 600);
      this.g = { ...g, approachT: null };
      if (dv) {
        const size = Math.hypot(dv[0], dv[1]);
        if (size >= 0.05) {
          state = this.consume(state, spec, dv);
          k = { r: state.r, v: state.v };
          this.p = {
            ...this.p,
            corrections: this.p.corrections + 1,
            correctionDvMS: this.p.correctionDvMS + size,
          };
          notes.push({ tS: t, kind: 'info', text: `Approach correction: ${size.toFixed(1)} m/s.` });
        }
      }
      // Fix where the site lies on the ground track (the timed-arrival abstraction).
      const tEntry = timeToRadius(k, MARS_RADIUS_M + MARS_NUMERIC_ALT_M);
      if (tEntry !== null) {
        const at = propagateKepler(k, MARS_MU_M3S2, tEntry);
        const probe: FlightState = {
          ...state,
          tS: t + tEntry,
          r: at.r,
          v: at.v,
          pitchDeg: flightPathAngleDeg(at.r, at.v),
        };
        const angle = lockSiteAngle(probe, spec, { site: this.siteNow, terrain: this.terrainNow });
        if (angle !== null) {
          this.siteAngle = angle;
          this.p = { ...this.p, siteLocked: true };
          message = `Approach set for ${this.siteNow.name}: entry in ${Math.round(tEntry / 3_600)} h.`;
        } else message = 'No safe entry corridor found: the ship will come down off target.';
      } else message = 'The approach misses the atmosphere.';
      notes.push({ tS: t, kind: this.p.siteLocked ? 'success' : 'warn', text: message });
    }
    // Reached the numeric region: entry guidance takes over (if engaged).
    if (toLow !== null && dt >= toLow - 1e-6) {
      if (this.g.program === 'mars-entry')
        this.g = { ...this.g, phase: 'descent', descent: ENTRY_START };
      message = 'Entry interface: guidance flying the entry.';
      return {
        state: { ...state, pitchDeg: flightPathAngleDeg(state.r, state.v) },
        used: dt,
        notes,
        message,
        slowDown: true,
      };
    }
    return { state, used: dt, notes, ...(message ? { message } : {}) };
  }

  private descentStep(s: FlightState, spec: ShipSpec, manual: FlightControls | null): VoyageStep {
    const ground = this.ground;
    let controls: FlightControls;
    let message: string | undefined;
    const notes: FlightEvent[] = [];
    if (this.g.program === 'mars-entry' && this.g.descent && !manual) {
      const out = runMarsDescent(this.g.descent, s, spec, ground, FINE_DT_S);
      this.g = { ...this.g, descent: out.next, phase: 'descent' };
      controls = out.controls;
      if (out.message) message = out.message;
    } else {
      controls = manual ?? {
        targetPitchDeg: s.pitchDeg,
        bankDeg: 0,
        yawDeg: 0,
        throttle: 0,
        slewDegS: marsSlewRate(s),
      };
    }
    const next = stepMarsFlight(s, spec, controls, FINE_DT_S, ground);
    // Objectives near the ground.
    const geo = marsGeometry(next, ground);
    if (geo.radarM < MANUAL_MARS_ALT_M && next.phase === 'flight') {
      if (this.g.program === 'mars-entry' && !manual) this.assistedLow = true;
      else this.manualLow = true;
    }
    if (!this.p.entry && geo.h < 100_000 && next.heatFluxWm2 > 0) {
      this.p = { ...this.p, entry: true, entrySpeedMS: geo.speed };
      notes.push({
        tS: next.tS,
        kind: 'info',
        text: `Entering the atmosphere at ${(geo.speed / 1000).toFixed(2)} km/s.`,
      });
    }
    if (message) notes.push({ tS: next.tS, kind: 'info', text: message });
    return { state: next, used: FINE_DT_S, notes, ...(message ? { message } : {}) };
  }

  /** Warp limit while on the way to Mars or near it. */
  voyageLimit(s: FlightState): { max: number; reason: string | null } {
    if (s.phase !== 'flight') return { max: 1, reason: 'The ship is down.' };
    if (s.origin === 'sun') return { max: 1_000_000, reason: null };
    const f = marsFrame(s.r);
    if (f.altitudeM < MARS_NUMERIC_ALT_M || s.throttle > 0)
      return { max: 10, reason: 'Entry and landing: warp limited to 10×.' };
    const toLow = timeToRadius({ r: s.r, v: s.v }, MARS_RADIUS_M + MARS_NUMERIC_ALT_M);
    if (toLow !== null && toLow < 900)
      return { max: 10, reason: 'Entry interface coming up: warp limited to 10×.' };
    if (toLow !== null && toLow < 4 * 3_600)
      return { max: 1_000, reason: 'Close to Mars: warp limited to 1000×.' };
    return { max: 100_000, reason: 'Near Mars: warp limited to 100,000×.' };
  }

  /** Extra warp limits in the Earth phase (injection), and deep-space warp once well away. */
  earthLimit(s: FlightState): { max: number; reason: string | null } | null {
    const g = this.g;
    if (g.program === 'trans-mars' && g.tmi) {
      if (g.phase === 'burn') return { max: 10, reason: 'Engines burning: warp limited to 10×.' };
      if (g.phase === 'wait') {
        const togo = g.tmi.burnStartT - s.tS;
        if (togo < 300) return { max: 10, reason: 'Burn coming up: warp limited to 10×.' };
        if (togo < 3_000) return { max: 100, reason: 'Burn coming up: warp limited to 100×.' };
      }
    }
    if (this.p.tmi && Math.hypot(s.r[0], s.r[1]) > 60_000_000 && !this.op)
      return { max: 10_000, reason: null };
    return null;
  }

  /** Coasting step (s) in the Earth phase once far out (fewer steps at high warp). */
  earthCoastDt(s: FlightState): number {
    const d = Math.hypot(s.r[0], s.r[1]);
    return Math.max(1, Math.min(600, Math.sqrt(d ** 3 / EARTH_MU_M3S2) / 400));
  }

  // ---- landing and surface ----

  /** Records a touchdown on Mars. Returns true if the ship stands (surface operations). */
  onTouchdown(s: FlightState): boolean {
    const td = s.touchdown;
    if (td?.body !== 'mars' || this.p.landing) return false;
    const outcome = s.phase === 'landed' ? 'landed' : s.phase === 'tipped' ? 'tipped' : 'crashed';
    const miss = Math.abs(td.siteOffsetM ?? 0);
    this.p = {
      ...this.p,
      landedT: s.tS,
      landing: {
        siteId: this.siteNow.id,
        siteName: this.siteNow.name,
        outcome,
        grade:
          outcome === 'landed' && td.siteOffsetM !== undefined
            ? rateLanding(
                {
                  missM: miss,
                  vertMS: td.vertMS,
                  horizMS: td.horizMS,
                  tiltDeg: td.tiltDeg + (td.slopeDeg ?? 0),
                },
                marsRatingLimits(),
              ).grade
            : null,
        manual: this.manualLow && !this.assistedLow,
        missM: miss,
      },
    };
    this.g = { ...this.g, program: 'none', phase: 'done' };
    if (outcome !== 'landed') return false;
    this.surface = { startT: s.tS, tasks: marsSurfaceTasks(this.siteNow, this.plan.plant) };
    this.surfaceElapsed = 0;
    return true;
  }

  /** Advances surface time; returns a note when the tasks complete. */
  surfaceStep(dt: number): string | null {
    if (!this.surface) return null;
    this.surfaceElapsed += dt;
    const done = marsSurfaceProgress(this.surface.tasks, this.surfaceElapsed).every((p) => p >= 1);
    if (done && !this.p.surfaceDone) {
      this.p = { ...this.p, surfaceDone: true };
      return this.plan.plant
        ? 'The propellant plant is running. Complete the mission to hand it over to ground control.'
        : 'Cargo delivered. Complete the mission to hand over to ground control.';
    }
    return null;
  }

  /** A ship standing on Mars at time t (it doesn't move: Mars's rotation isn't simulated). */
  standing(s: FlightState): FlightState {
    return s;
  }

  // ---- objectives ----

  /** Summary for the flight record. */
  summary(): MarsSummary {
    const p = this.p;
    return {
      launchDay: this.plan.launchDay,
      departed: p.departedT !== null,
      cruiseDays:
        p.arrivedT !== null && p.departedT !== null ? (p.arrivedT - p.departedT) / DAY_S : null,
      corrections: p.corrections,
      correctionDvMS: p.correctionDvMS,
      entrySpeedMS: p.entrySpeedMS,
      landing: p.landing,
      surfaceDone: p.surfaceDone,
      plantRunning: this.plan.plant && p.surfaceDone,
      ice: p.landing?.outcome === 'landed' ? this.siteNow.ice : null,
      landedDay: p.landedT !== null ? Math.floor(this.programT(p.landedT) / DAY_S) : null,
    };
  }

  // ---- view ----

  private arrivalView(s: FlightState): ArrivalView | null {
    if (s.origin !== 'sun') return null;
    const c = this.arrivalCache;
    if (c && Math.abs(c.at - s.tS) < 6 * 3_600 && c.prop === s.propKg) return c.view;
    const T = this.programT(s.tS);
    const p = predictArrival({ r: s.r, v: s.v }, T);
    const metric = cruiseMetric({ r: s.r, v: s.v }, T);
    const view: ArrivalView | null = p
      ? {
          closestT: p.closestT - this.plan.launchDay * DAY_S,
          aimErrorKm: metric !== null ? metric / 1000 : 0,
          vInfMS: p.vInfMS,
        }
      : null;
    this.arrivalCache = { at: s.tS, prop: s.propKg, view };
    return view;
  }

  view(s: FlightState | null): MarsView {
    const tS = s?.tS ?? 0;
    const T = this.programT(tS);
    const earth = planetState('earth', T);
    const mars = planetState('mars', T);
    let shipHelio: Vec2 = earth.r;
    let frame: MarsView['frame'] = 'earth';
    let marsAltitudeM: number | null = null;
    let marsSpeedMS: number | null = null;
    let marsElements: OrbitalElements | null = null;
    if (s) {
      if (s.origin === 'sun') {
        frame = 'sun';
        shipHelio = s.r;
      } else if (s.origin === 'mars') {
        frame = 'mars';
        shipHelio = [mars.r[0] + s.r[0], mars.r[1] + s.r[1]];
        const f = marsFrame(s.r);
        marsAltitudeM = f.altitudeM;
        marsSpeedMS = Math.hypot(s.v[0], s.v[1]);
        marsElements = orbitalElements(s.r, s.v, MARS_BODY);
      } else shipHelio = [earth.r[0] + s.r[0], earth.r[1] + s.r[1]];
      // The predicted heliocentric path, refreshed now and then.
      if (s.origin === 'sun' && (tS - this.pathT > PATH_REFRESH_S || s.propKg !== this.pathProp)) {
        const arrival = this.arrivalView(s);
        const span = arrival ? Math.max(DAY_S, arrival.closestT - tS) : 300 * DAY_S;
        const pts: Vec2[] = [];
        for (let i = 0; i <= 120; i++) {
          const p = propagateKepler({ r: s.r, v: s.v }, SUN_MU_M3S2, (span * i) / 120);
          pts.push(p.r);
        }
        this.path = pts;
        this.pathT = tS;
        this.pathProp = s.propKg;
      } else if (s.origin !== 'sun') this.path = [];
    }
    const near = s?.origin === 'mars';
    return {
      plan: this.plan,
      guidance: this.g,
      progress: this.p,
      programT: T,
      day: T / DAY_S,
      frame,
      earth,
      mars,
      shipHelio,
      path: this.path,
      arrival: s ? this.arrivalView(s) : null,
      marsAltitudeM,
      marsSpeedMS,
      marsElements,
      site: this.siteNow,
      terrain: this.terrainNow,
      siteAngle: this.siteAngle,
      canChangeSite: this.canChangeSite,
      geometry:
        s && near && (marsAltitudeM ?? Infinity) < 300_000 ? marsGeometry(s, this.ground) : null,
      descent: this.g.descent,
      surface: this.surface
        ? {
            startT: this.surface.startT,
            elapsedS: this.surfaceElapsed,
            tasks: this.surface.tasks,
            progress: marsSurfaceProgress(this.surface.tasks, this.surfaceElapsed),
            done: this.p.surfaceDone,
          }
        : null,
      refuel: this.op,
      refuelAvailable: s ? this.refuelAvailability(s) : { ok: false },
      manualAllowed: s ? this.manualAllowed(s) : false,
      programs: {
        'trans-mars': s ? this.availability('trans-mars', s) : { ok: false },
        'mars-cruise': s ? this.availability('mars-cruise', s) : { ok: false },
        'mars-entry': s ? this.availability('mars-entry', s) : { ok: false },
      },
    };
  }
}
