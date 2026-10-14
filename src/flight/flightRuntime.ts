import { MAX_STEPS_PER_FRAME } from '../simulation/constants';
import type { BoosterRecoverySummary, FlightRecord, OutcomeInput } from '../launch/flightRecord';
import type { RocketBlueprint } from '../rocket/model/types';
import {
  attitudeTarget,
  IDLE_PROGRAM,
  runProgram,
  slewRate,
  type AttitudeMode,
  type ProgramId,
  type ProgramState,
} from './autopilot';
import {
  initialFlightState,
  stepFlight,
  type FlightControls,
  type FlightEvent,
  type FlightState,
  type ShipSpec,
} from './flightModel';
import {
  evaluateFlight,
  NO_PROGRESS,
  type FlightOutcomeContext,
  type FlightProgress,
} from './flightOutcome';
import { findZone, LANDING_ZONES, type LandingZone } from './landingZones';
import { len, localFrame, orbitalElements, wrapAngle, type Vec2 } from './orbitMath';
import {
  CLOSE_RANGE_M,
  HANDOVER_RANGE_M,
  HANDOVER_SPEED_MS,
  RENDEZVOUS_START,
  rendezvousView,
  runRendezvous,
  transferPhase,
  type RendezvousState,
  type RendezvousView,
} from '../station/rendezvous';
import {
  fromStationFrame,
  STATION_RADIUS_M,
  stationState,
  toStationFrame,
  type StationEphemeris,
} from '../station/stationOrbit';
import { ProximitySession, type ProximityView, type ProxKey } from '../station/proximitySession';
import type { AssistMode } from '../station/proximity';
import { EARTH_RADIUS_M } from '../simulation/constants';
import {
  isLunarProgram,
  LunarFlight,
  type LunarMissionPlan,
  type LunarView,
} from '../moon/lunarFlight';
import {
  inLunarOrbit,
  LUNAR_PROGRAM_LABELS,
  lunarProgramAvailability,
} from '../moon/lunarTransfer';
import { coastDt } from '../moon/propagate';
import type { GravityEnv } from '../moon/moonOrbit';

/*
 * Flight runtime: one orbital flight session from orbit insertion to touchdown. Framework-free
 * like LaunchRuntime: the scene calls update() every frame, the simulation advances in fixed
 * steps (finer in the atmosphere or under thrust, coarse only for unpowered coasting in space),
 * and the UI subscribes to throttled snapshots.
 */

export type FlightSessionPhase = 'idle' | 'flight' | 'proximity' | 'debrief';
/** The station's transfer window opens about this far (phase, rad) after orbit insertion. */
export const STATION_PHASE_LEAD_RAD = 0.05;
export const FLIGHT_WARP_LEVELS = [1, 2, 5, 10, 50, 100, 500, 1000, 5000, 10000] as const;
export type FlightWarp = (typeof FLIGHT_WARP_LEVELS)[number];

/** Fine step (atmosphere, burns) and coarse step (vacuum coasting at high warp). */
export const FINE_DT_S = 0.05;
export const COARSE_DT_S = 1;
/** Highest warp allowed while the fine step is required. */
export const MAX_FINE_WARP: FlightWarp = 10;
/** High warp only above this altitude (thin enough to ignore drag at the coarse step). */
export const HIGH_WARP_MIN_ALT_M = 110_000;
const PUBLISH_INTERVAL_S = 0.1;
const DEBRIEF_DELAY_S = 4;
/** Manual control rates. */
export const PITCH_RATE_DEG_S = 20;
export const BANK_RATE_DEG_S = 40;
export const THROTTLE_RATE_S = 0.6;
/** Re-entry counts as survived once the ship slows below this altitude intact. */
const REENTRY_DONE_ALT_M = 20_000;
const DEORBIT_PE_M = 80_000;
/** A landing counts as manual if the player flew everything below this height. */
export const MANUAL_LANDING_ALT_M = 5_000;

export interface FlightContext {
  readonly outcome: OutcomeInput;
  readonly blueprint: RocketBlueprint;
  readonly designRevision: number;
  readonly crewed: boolean;
  readonly crewNames: readonly string[];
  readonly spec: ShipSpec;
  readonly start: {
    readonly r: Vec2;
    readonly v: Vec2;
    readonly propKg: number;
    readonly tS: number;
  };
  readonly ascent: FlightOutcomeContext['ascent'];
  /** Booster recovery result from the launch (carried into the flight record). */
  readonly recovery: BoosterRecoverySummary | null;
  readonly hardware: { readonly boosterId: string | null; readonly shipId: string | null };
  /** Station mission details (crew to hand over, supplies to unload). */
  readonly station?: { readonly crew: number; readonly cargo: boolean };
  /** Moon missions: the goal and the refuelling bought in Mission Control. */
  readonly lunar?: LunarMissionPlan;
}

export type ManualKey =
  'pitch-up' | 'pitch-down' | 'bank-left' | 'bank-right' | 'throttle-up' | 'throttle-down';

export interface FlightSnapshot {
  readonly phase: FlightSessionPhase;
  readonly context: FlightContext | null;
  readonly state: FlightState | null;
  readonly progress: FlightProgress;
  readonly mode: AttitudeMode;
  readonly program: ProgramState;
  readonly zone: LandingZone;
  readonly manual: {
    readonly pitchDeg: number;
    readonly bankDeg: number;
    readonly yawDeg: number;
    readonly throttle: number;
  };
  readonly paused: boolean;
  readonly warp: FlightWarp;
  /** Highest warp currently allowed and why lower levels are enforced. */
  readonly maxWarp: FlightWarp;
  readonly warpLimitReason: string | null;
  readonly record: FlightRecord | null;
  /** Most recent guidance / system message. */
  readonly message: string | null;
  /** The station (once tracked) and the rendezvous guidance. */
  readonly station: { readonly eph: StationEphemeris; readonly view: RendezvousView } | null;
  readonly rendezvous: RendezvousState;
  /** Proximity operations near the station (phase 'proximity'). */
  readonly proximity: ProximityView | null;
  /** Moon missions: the Moon, lunar guidance, refuelling and lunar objectives. */
  readonly lunar: LunarView | null;
}

const DEFAULT_ZONE = findZone('platform') ?? LANDING_ZONES[0]!;

const IDLE: FlightSnapshot = {
  phase: 'idle',
  context: null,
  state: null,
  progress: NO_PROGRESS,
  mode: 'prograde',
  program: IDLE_PROGRAM,
  zone: DEFAULT_ZONE,
  manual: { pitchDeg: 0, bankDeg: 0, yawDeg: 0, throttle: 0 },
  paused: false,
  warp: 1,
  maxWarp: 1000,
  warpLimitReason: null,
  record: null,
  message: null,
  station: null,
  rendezvous: RENDEZVOUS_START,
  proximity: null,
  lunar: null,
};

/** Highest warp allowed for a state (pure; exported for tests and the UI). */
export function warpLimit(
  s: FlightState,
  ps: ProgramState,
  throttle: number,
): { max: FlightWarp; reason: string | null } {
  if (s.phase !== 'flight') return { max: 1, reason: 'The ship is down.' };
  const alt = localFrame(s.r).altitudeM;
  if (alt < HIGH_WARP_MIN_ALT_M)
    return { max: MAX_FINE_WARP, reason: 'Inside the atmosphere: warp limited to 10×.' };
  if (throttle > 0 || ps.burning)
    return { max: MAX_FINE_WARP, reason: 'Engines burning: warp limited to 10×.' };
  if (ps.program === 'deorbit' && ps.deorbitBurnAngle !== null) {
    const togo = wrapAngle(ps.deorbitBurnAngle - localFrame(s.r).groundAngle);
    if (togo >= 0 && togo < 0.12)
      return { max: MAX_FINE_WARP, reason: 'Deorbit burn coming up: warp limited to 10×.' };
  }
  if (ps.program === 'circularize') {
    const el = orbitalElements(s.r, s.v);
    if (Math.abs(el.verticalSpeedMS) < 60)
      return { max: MAX_FINE_WARP, reason: 'Near apoapsis: warp limited to 10×.' };
  }
  return { max: 1000, reason: null };
}

export class FlightRuntime {
  private state: FlightSnapshot = IDLE;
  private snap: FlightSnapshot = IDLE;
  private live: FlightState | null = null;
  private progress: FlightProgress = NO_PROGRESS;
  private ps: ProgramState = IDLE_PROGRAM;
  private mode: AttitudeMode = 'prograde';
  private manual = { pitchDeg: 0, bankDeg: 0, yawDeg: 0, throttle: 0 };
  private keys = new Set<ManualKey>();
  private message: string | null = null;
  private accumulator = 0;
  private sincePublish = 0;
  private sinceDown = 0;
  private maxAltitudeM = 0;
  private maxSpeedMS = 0;
  private lastAngle = 0;
  /** Final descent (below MANUAL_LANDING_ALT_M) flown by the player / by the landing program. */
  private manualDescent = false;
  private assistedDescent = false;
  private eph: StationEphemeris | null = null;
  private rdv: RendezvousState = RENDEZVOUS_START;
  private prox: ProximitySession | null = null;
  private lunar: LunarFlight | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly onRecord: (record: FlightRecord) => void,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): FlightSnapshot => this.snap;

  /** Latest ship state for rendering (may be newer than the published snapshot). */
  get liveState(): FlightState | null {
    return this.live;
  }
  get current(): FlightSnapshot {
    return this.state;
  }
  get active(): boolean {
    return this.state.phase === 'flight';
  }

  // ---- commands ----

  /** Starts a flight from the ascent hand-off. Assisted by default: circularizes if needed. */
  start(context: FlightContext): void {
    const { r, v, propKg, tS } = context.start;
    this.live = initialFlightState(r, v, propKg, tS);
    const el = orbitalElements(r, v);
    this.progress = { ...NO_PROGRESS, orbit: el.status === 'orbit' };
    this.ps = el.status === 'orbit' ? IDLE_PROGRAM : { ...IDLE_PROGRAM, program: 'circularize' };
    this.mode = 'prograde';
    this.manual = { pitchDeg: this.live.pitchDeg, bankDeg: 0, yawDeg: 0, throttle: 0 };
    this.keys.clear();
    this.message =
      el.status === 'orbit'
        ? 'Orbit confirmed. Holding prograde.'
        : 'Orbit not yet stable: circularization program engaged.';
    this.accumulator = 0;
    this.sinceDown = 0;
    this.maxAltitudeM = localFrame(r).altitudeM;
    this.maxSpeedMS = len(v);
    this.lastAngle = localFrame(r).groundAngle;
    this.manualDescent = false;
    this.assistedDescent = false;
    this.eph = null;
    this.rdv = RENDEZVOUS_START;
    this.prox = null;
    this.lunar = context.lunar ? new LunarFlight(context.lunar) : null;
    if (this.progress.orbit) this.trackStation(this.live);
    this.set({ ...IDLE, phase: 'flight', context, zone: this.state.zone }, true);
  }

  reset(): void {
    this.live = null;
    this.prox = null;
    this.lunar = null;
    this.eph = null;
    this.keys.clear();
    this.set({ ...IDLE, zone: this.state.zone });
  }

  togglePause(): void {
    if (this.state.phase === 'flight' || this.state.phase === 'proximity')
      this.set({ ...this.state, paused: !this.state.paused });
  }

  setWarp(warp: FlightWarp): void {
    if (this.state.phase !== 'flight' && this.state.phase !== 'proximity') return;
    if (this.state.phase === 'proximity') {
      const max = this.prox?.maxWarp ?? 1;
      this.set({ ...this.state, warp: Math.min(warp, max) as FlightWarp }, true);
      return;
    }
    const w = Math.min(warp, this.state.maxWarp) as FlightWarp;
    if (warp > this.state.maxWarp && this.state.warpLimitReason)
      this.message = this.state.warpLimitReason;
    this.set({ ...this.state, warp: w }, true);
  }

  setZone(id: string): void {
    const zone = findZone(id);
    if (!zone) return;
    // A new target invalidates any deorbit/re-entry plan.
    if (this.ps.program === 'deorbit' && !this.ps.burning)
      this.ps = { ...IDLE_PROGRAM, program: 'deorbit' };
    if (this.ps.program === 'reentry') this.ps = { ...this.ps, lastPredictionT: -Infinity };
    this.set({ ...this.state, zone }, true);
  }

  setMode(mode: AttitudeMode): void {
    if (!this.live || this.state.phase !== 'flight') return;
    this.disengage(mode === 'manual' ? 'Manual attitude.' : null);
    this.mode = mode;
    if (mode === 'manual') this.manual = { ...this.manual, pitchDeg: this.live.pitchDeg };
    this.publish();
  }

  /** Engages a guidance program, or explains why it can't run now. */
  engage(program: ProgramId): { ok: boolean; reason?: string } {
    const s = this.live;
    if (!s || this.state.phase !== 'flight') return { ok: false, reason: 'No ship in flight.' };
    const check = programAvailability(
      program,
      s,
      this.progress,
      {
        dockingAdapter: !!this.state.context?.spec.hasDockingAdapter,
        stationRangeM: this.stationRange(s),
      },
      this.lunarCheck(s),
    );
    if (!check.ok) {
      this.message = check.reason ?? null;
      this.publish();
      return check;
    }
    if (program === 'rendezvous' && !this.eph) this.trackStation(s);
    if (this.lunar?.refuelling) {
      this.message = 'Refuelling in progress: wait for it to finish.';
      this.publish();
      return { ok: false, reason: this.message };
    }
    this.ps = program === 'none' ? IDLE_PROGRAM : { ...IDLE_PROGRAM, program };
    if (isLunarProgram(program)) this.lunar?.startProgram(program);
    else this.lunar?.stopProgram();
    if (program === 'rendezvous') this.rdv = RENDEZVOUS_START;
    if (program === 'none') this.disengage('Autopilot off.');
    else this.message = `${PROGRAM_LABELS[program]} engaged.`;
    this.publish();
    return { ok: true };
  }

  /** Cuts the engines and drops any program (manual takeover). */
  cutoff(): void {
    if (!this.live) return;
    this.disengage('Engine cutoff.');
    this.manual = { ...this.manual, throttle: 0 };
    this.publish();
  }

  setThrottle(throttle: number): void {
    if (!this.live) return;
    this.disengage('Manual throttle: autopilot disengaged.');
    this.manual = { ...this.manual, throttle: Math.max(0, Math.min(1, throttle)) };
    this.publish();
  }

  setKey(key: ManualKey, down: boolean): void {
    if (this.state.phase !== 'flight') return;
    if (down && !this.keys.has(key)) {
      if (key.startsWith('throttle')) this.disengage('Manual throttle: autopilot disengaged.');
      else {
        this.disengage('Manual attitude: autopilot disengaged.');
        if (this.mode !== 'manual' && this.live)
          this.manual = { ...this.manual, pitchDeg: this.live.pitchDeg };
        this.mode = 'manual';
      }
    }
    if (down) this.keys.add(key);
    else this.keys.delete(key);
  }

  // ---- Moon ----

  /** Gravity environment (the Moon on lunar missions). */
  get env(): GravityEnv | null {
    return this.lunar?.env ?? null;
  }

  private lunarCheck(s: FlightState) {
    return this.lunar
      ? {
          env: this.lunar.env,
          goal: this.lunar.plan.goal,
          inLunarOrbit: inLunarOrbit(s, this.lunar.env),
        }
      : null;
  }

  /** Starts a refuelling operation (tankers in Earth orbit or the lunar depot). */
  refuel(): { ok: boolean; reason?: string } {
    const s = this.live;
    if (!s || !this.lunar || this.state.phase !== 'flight')
      return { ok: false, reason: 'Refuelling is only offered on Moon missions.' };
    if (this.ps.program !== 'none' || s.throttle > 0) {
      this.message = 'Turn the autopilot and engines off before refuelling.';
      this.publish();
      return { ok: false, reason: this.message };
    }
    const r = this.lunar.startRefuel(s);
    this.message = r.ok
      ? this.lunar.refuelling?.kind === 'leo'
        ? 'Tankers on the way: refuelling in orbit (about 6 hours; time warp is available).'
        : 'Docking at the lunar depot: topping up (about 3 hours; time warp is available).'
      : (r.reason ?? null);
    this.publish();
    return r;
  }

  // ---- station ----

  /** Fixes the station's position so its transfer window opens shortly (a launch window). */
  private trackStation(s: FlightState): void {
    if (this.eph) return;
    const f = localFrame(s.r);
    this.eph = {
      angle0: wrapAngle(
        f.groundAngle + transferPhase(EARTH_RADIUS_M + f.altitudeM) + STATION_PHASE_LEAD_RAD,
      ),
      t0: s.tS,
    };
  }

  private stationRange(s: FlightState): number | null {
    if (!this.eph) return null;
    const rel = toStationFrame(stationState(this.eph, s.tS), s.r, s.v);
    return Math.hypot(rel.p[0], rel.p[1]);
  }

  /** Whether proximity operations can start now, with a reason if not. */
  proximityAvailability(): { ok: boolean; reason?: string } {
    const s = this.live;
    const ctx = this.state.context;
    if (!s || !ctx || this.state.phase !== 'flight' || s.phase !== 'flight')
      return { ok: false, reason: 'No ship in flight.' };
    if (!this.eph)
      return { ok: false, reason: 'Reach orbit first: the station is tracked from orbit.' };
    if (!ctx.spec.hasDockingAdapter)
      return { ok: false, reason: 'The ship has no docking adapter on its nose.' };
    const rel = toStationFrame(stationState(this.eph, s.tS), s.r, s.v);
    const range = Math.hypot(rel.p[0], rel.p[1]);
    const speed = Math.hypot(rel.v[0], rel.v[1]);
    if (range > HANDOVER_RANGE_M)
      return {
        ok: false,
        reason: `Too far from the station (${(range / 1000).toFixed(1)} km; within ${HANDOVER_RANGE_M / 1000} km).`,
      };
    if (speed > HANDOVER_SPEED_MS * 2)
      return { ok: false, reason: `Relative speed too high (${speed.toFixed(1)} m/s).` };
    return { ok: true };
  }

  /** Hands the ship over to proximity operations near the station. */
  beginProximity(): { ok: boolean; reason?: string } {
    const check = this.proximityAvailability();
    if (!check.ok || !this.live || !this.eph) return check;
    const s = this.live;
    const rel = toStationFrame(stationState(this.eph, s.tS), s.r, s.v);
    const st = this.state.context?.station;
    this.prox = new ProximitySession(rel, s.tS, s.hull, st?.crew ?? 0, st?.cargo ?? false);
    this.ps = IDLE_PROGRAM;
    this.rdv = RENDEZVOUS_START;
    this.manual = { ...this.manual, throttle: 0 };
    this.keys.clear();
    this.progress = { ...this.progress, rendezvous: true };
    this.message = 'Proximity operations: approach the forward port along the corridor.';
    this.state = { ...this.state, phase: 'proximity', warp: 1 };
    this.publish();
    return { ok: true };
  }

  get proximity(): ProximityView | null {
    return this.prox?.view() ?? null;
  }

  setProxKey(key: ProxKey, down: boolean): void {
    this.prox?.setKey(key, down);
  }

  setProxAssist(mode: AssistMode): void {
    this.prox?.setAssist(mode);
    this.publish();
  }

  setProxHold(on: boolean): void {
    this.prox?.setHold(on);
    this.publish();
  }

  setProxAlign(on: boolean): void {
    this.prox?.setAlign(on);
    this.publish();
  }

  undock(): void {
    if (this.prox?.undock()) this.message = 'Undocked. Back out beyond 300 m, then depart.';
    this.publish();
  }

  /** Leaves proximity operations and resumes orbital flight (after undocking, beyond 300 m). */
  depart(): { ok: boolean; reason?: string } {
    const prox = this.prox;
    const s = this.live;
    if (!prox || !s || !this.eph || this.state.phase !== 'proximity')
      return { ok: false, reason: 'Not near the station.' };
    const view = prox.view();
    if (!view.canDepart)
      return {
        ok: false,
        reason:
          view.state.phase === 'docked'
            ? 'Undock first.'
            : 'Back out beyond 300 m from the station first.',
      };
    this.resumeFromProximity(prox);
    return { ok: true };
  }

  private resumeFromProximity(prox: ProximitySession): void {
    const s = this.live!;
    const ps = prox.state;
    const view = prox.view();
    const { r, v } = fromStationFrame(stationState(this.eph!, ps.tS), { p: ps.p, v: ps.v });
    const docking = ps.docking
      ? {
          grade: ps.docking.grade,
          manual: ps.docking.manual,
          bounces: ps.bounces,
          collisions: ps.collisions,
          violations: ps.violations,
          tasksDone: view.tasksDone,
        }
      : ps.bounces + ps.collisions > 0
        ? {
            grade: null,
            manual: false,
            bounces: ps.bounces,
            collisions: ps.collisions,
            violations: ps.violations,
            tasksDone: false,
          }
        : (this.progress.docking ?? null);
    const events = ps.events.map((e) => ({ ...e }));
    this.live = {
      ...s,
      tS: ps.tS,
      r,
      v,
      hull: ps.hull,
      throttle: 0,
      pitchDeg: orbitalElements(r, v).flightPathAngleDeg,
      events: [...s.events, ...events],
      ...(ps.phase === 'destroyed' ? { phase: 'destroyed' as const } : {}),
    };
    this.lastAngle = localFrame(r).groundAngle;
    this.progress = { ...this.progress, docking };
    this.prox = null;
    this.mode = 'prograde';
    this.manual = { ...this.manual, pitchDeg: this.live.pitchDeg, throttle: 0 };
    this.message = docking?.tasksDone
      ? 'Departed the station. Deorbit to a landing zone to bring the crew home.'
      : 'Left the station.';
    this.state = { ...this.state, phase: 'flight', warp: 1 };
    this.publish();
  }

  /** Ends the flight where it is (only offered while still flying). */
  endFlight(): void {
    if (this.state.phase === 'flight' && this.live?.phase === 'flight') this.finish();
  }

  private disengage(message: string | null): void {
    const s = this.live;
    if (this.ps.program !== 'none' && s) {
      // Hand over smoothly: keep what the autopilot was doing.
      this.manual = {
        ...this.manual,
        pitchDeg: s.pitchDeg,
        bankDeg: s.bankDeg,
        throttle: s.throttle,
      };
      this.ps = IDLE_PROGRAM;
      this.lunar?.stopProgram();
      if (message) this.message = message;
    }
  }

  // ---- per-frame update ----

  update(realDtS: number): void {
    const st = this.state;
    if (st.phase === 'proximity') return this.updateProximity(realDtS);
    if (st.phase !== 'flight' || !this.live || !st.context) return;
    if (this.live.phase !== 'flight') {
      this.sinceDown += realDtS;
      if (this.sinceDown >= DEBRIEF_DELAY_S && !st.record) this.finish();
      return;
    }
    if (st.paused) return;
    this.applyKeys(realDtS);
    const spec = st.context.spec;
    const eventsBefore = this.live.events.length;
    this.accumulator += realDtS * st.warp;
    let steps = 0;
    while (steps < MAX_STEPS_PER_FRAME && this.live.phase === 'flight') {
      const lim = this.limit(this.live);
      const coarse = this.lunar ? coastDt(this.live.r, this.live.tS, this.lunar.env) : COARSE_DT_S;
      const dt = st.warp > MAX_FINE_WARP && lim.max > MAX_FINE_WARP ? coarse : FINE_DT_S;
      if (this.accumulator < dt) break;
      this.step(spec, dt);
      this.accumulator -= dt;
      steps++;
      // Drop to an allowed warp as soon as a limit applies (e.g. approaching a burn).
      const after = this.limit(this.live);
      if (this.state.warp > after.max) {
        this.state = { ...this.state, warp: after.max };
        this.accumulator = Math.min(this.accumulator, FINE_DT_S);
        if (after.reason) this.message = after.reason;
        break;
      }
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.sincePublish += realDtS;
    if (
      this.live.events.length !== eventsBefore ||
      this.live.phase !== 'flight' ||
      this.sincePublish >= PUBLISH_INTERVAL_S
    ) {
      this.publish();
    }
  }

  private updateProximity(realDtS: number): void {
    const prox = this.prox;
    if (!prox || this.state.paused) return;
    const warp = Math.min(this.state.warp, prox.maxWarp) as FlightWarp;
    if (warp !== this.state.warp) this.state = { ...this.state, warp };
    const eventsBefore = prox.state.events.length;
    this.accumulator += realDtS * warp;
    // Docked time advances in coarse steps (nothing moves); free flight uses fine steps.
    const dt = prox.state.phase === 'docked' ? COARSE_DT_S : FINE_DT_S;
    let steps = 0;
    while (this.accumulator >= dt && steps < MAX_STEPS_PER_FRAME) {
      const wasDocked = prox.state.phase === 'docked';
      prox.step(dt);
      this.accumulator -= dt;
      steps++;
      const phase: string = prox.state.phase;
      if (phase === 'destroyed') break;
      // Docking stops time warp so the player sees it happen.
      if (!wasDocked && phase === 'docked') {
        this.message = 'Docked! Run the station tasks (time warp is available while docked).';
        break;
      }
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    if (prox.state.phase === 'destroyed') {
      this.resumeFromProximity(prox);
      return;
    }
    this.sincePublish += realDtS;
    if (prox.state.events.length !== eventsBefore || this.sincePublish >= PUBLISH_INTERVAL_S)
      this.publish();
  }

  private applyKeys(realDtS: number): void {
    const k = this.keys;
    if (k.size === 0) return;
    let { pitchDeg, bankDeg, throttle } = this.manual;
    if (k.has('pitch-up')) pitchDeg += PITCH_RATE_DEG_S * realDtS;
    if (k.has('pitch-down')) pitchDeg -= PITCH_RATE_DEG_S * realDtS;
    if (k.has('bank-left')) bankDeg = Math.max(-90, bankDeg - BANK_RATE_DEG_S * realDtS);
    if (k.has('bank-right')) bankDeg = Math.min(90, bankDeg + BANK_RATE_DEG_S * realDtS);
    if (k.has('throttle-up')) throttle = Math.min(1, throttle + THROTTLE_RATE_S * realDtS);
    if (k.has('throttle-down')) throttle = Math.max(0, throttle - THROTTLE_RATE_S * realDtS);
    this.manual = { ...this.manual, pitchDeg: ((pitchDeg % 360) + 360) % 360, bankDeg, throttle };
  }

  private step(spec: ShipSpec, dt: number): void {
    const s = this.live!;
    const zone = this.state.zone;
    let controls: FlightControls;
    if (isLunarProgram(this.ps.program) && this.lunar) {
      const out = this.lunar.run(s, spec);
      this.mode = 'manual';
      if (out.message) this.message = out.message;
      controls = { ...out.controls, yawDeg: this.manual.yawDeg, slewDegS: slewRate(s) };
      if (out.chain === 'none') {
        this.ps = IDLE_PROGRAM;
        this.manual = { ...this.manual, pitchDeg: s.pitchDeg, bankDeg: 0, throttle: 0 };
      } else if (out.chain) this.ps = { ...IDLE_PROGRAM, program: out.chain };
    } else if (this.ps.program === 'rendezvous' && this.eph) {
      const out = runRendezvous(this.rdv, s, this.eph);
      this.rdv = out.next;
      this.mode = 'manual';
      if (out.message) this.message = out.message;
      if (out.next.phase === 'hold') this.progress = { ...this.progress, rendezvous: true };
      controls = { ...out.controls, yawDeg: this.manual.yawDeg, slewDegS: slewRate(s) };
    } else if (this.ps.program !== 'none') {
      const out = runProgram(this.ps, s, spec, zone);
      this.ps = out.next;
      this.mode = out.mode;
      if (out.message) this.message = out.message;
      controls = { ...out.controls, yawDeg: this.manual.yawDeg, slewDegS: slewRate(s) };
      if (this.ps.program === 'none') {
        // Program finished: hold its attitude, engines off.
        this.manual = { ...this.manual, pitchDeg: s.pitchDeg, bankDeg: 0, throttle: 0 };
      }
    } else {
      controls = {
        targetPitchDeg: attitudeTarget(this.mode, s, this.manual.pitchDeg),
        bankDeg: this.manual.bankDeg,
        yawDeg: this.manual.yawDeg,
        throttle: this.manual.throttle,
        slewDegS: slewRate(s),
      };
    }
    let next = stepFlight(s, spec, controls, dt, this.env);
    if (this.lunar?.refuelling) {
      const r = this.lunar.applyRefuel(next, spec);
      next = r.state;
      if (r.done) {
        this.message = r.done;
        next = {
          ...next,
          events: [...next.events, { tS: next.tS, kind: 'success', text: r.done }],
        };
      }
    }
    this.live = next;
    this.track(s, next);
  }

  /** Objective tracking after each step. */
  private track(prev: FlightState, s: FlightState): void {
    const f = localFrame(s.r);
    const el = orbitalElements(s.r, s.v);
    this.maxAltitudeM = Math.max(this.maxAltitudeM, f.altitudeM);
    this.maxSpeedMS = Math.max(this.maxSpeedMS, len(s.v));
    if (f.altitudeM < MANUAL_LANDING_ALT_M && s.phase === 'flight') {
      if (this.ps.program === 'none') this.manualDescent = true;
      else this.assistedDescent = true;
    }
    const dA = wrapAngle(f.groundAngle - this.lastAngle);
    this.lastAngle = f.groundAngle;
    let p = this.progress;
    const notes: FlightEvent[] = [];
    if (!p.orbit && el.status === 'orbit') {
      p = { ...p, orbit: true, travelSinceOrbit: 0 };
      this.trackStation(s);
      notes.push({
        tS: s.tS,
        kind: 'success',
        text: `Stable orbit: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km.`,
      });
    } else if (p.orbit) {
      const before = Math.floor(p.travelSinceOrbit / (2 * Math.PI));
      p = { ...p, travelSinceOrbit: p.travelSinceOrbit + dA };
      const after = Math.floor(p.travelSinceOrbit / (2 * Math.PI));
      if (after > before && after >= 1)
        notes.push({ tS: s.tS, kind: 'success', text: `Orbit ${after} complete.` });
    }
    if (
      p.orbit &&
      !p.deorbit &&
      el.periapsisAltM < DEORBIT_PE_M &&
      el.status !== 'escape' &&
      el.apoapsisAltM < 2_000_000
    ) {
      p = { ...p, deorbit: true };
      notes.push({
        tS: s.tS,
        kind: 'info',
        text: `Deorbited: periapsis ${Math.round(el.periapsisAltM / 1000)} km.`,
      });
    }
    if (
      !p.reentry &&
      s.phase === 'flight' &&
      f.altitudeM < REENTRY_DONE_ALT_M &&
      s.peakHeatFluxWm2 > 0
    ) {
      p = { ...p, reentry: true };
      notes.push({
        tS: s.tS,
        kind: 'success',
        text: `Re-entry complete. Heat shield ${Math.round(s.shield * 100)}%.`,
      });
    }
    void prev;
    if (this.lunar) {
      notes.push(...this.lunar.track(s));
      p = { ...p, lunar: this.lunar.progress };
    }
    this.progress = p;
    if (notes.length) this.live = { ...s, events: [...s.events, ...notes] };
  }

  private finish(): void {
    const st = this.state;
    if (!st.context || !this.live || st.record) return;
    const record = evaluateFlight(
      {
        outcome: st.context.outcome,
        zone: st.zone,
        ascent: st.context.ascent,
        maxAltitudeM: this.maxAltitudeM,
        maxSpeedMS: this.maxSpeedMS,
        recovery: st.context.recovery,
        hardware: st.context.hardware,
        manualLanding: this.manualDescent && !this.assistedDescent,
      },
      this.live,
      this.progress,
      this.now(),
    );
    this.keys.clear();
    this.set(
      { ...this.state, phase: 'debrief', record, state: this.live, progress: this.progress },
      true,
    );
    this.onRecord(record);
  }

  /** Warp limit including the rendezvous guidance's needs. */
  private limit(s: FlightState): { max: FlightWarp; reason: string | null } {
    const base = warpLimit(s, this.ps, this.ps.program === 'none' ? this.manual.throttle : 0);
    if (this.lunar) {
      const extra = this.lunar.limit(s, this.ps.program);
      if (extra && extra.max < base.max)
        return { max: extra.max as FlightWarp, reason: extra.reason };
      if (!extra && base.max === 1000 && this.lunar.deepSpace(s))
        return { max: 10000, reason: null };
      if (base.max === 1000)
        return { max: 1000, reason: 'Near Earth or the Moon: warp limited to 1000×.' };
      return base;
    }
    if (base.max <= MAX_FINE_WARP || this.ps.program !== 'rendezvous' || !this.eph) return base;
    const r = this.rdv;
    const view = rendezvousView(r, s, this.eph);
    if (r.burning || r.phase === 'transfer' || r.phase === 'targeting')
      return { max: MAX_FINE_WARP, reason: 'Rendezvous manoeuvres: warp limited to 10×.' };
    // The coast needs no control, but the hand-over to targeting shouldn't overshoot.
    if (view.rangeM < CLOSE_RANGE_M)
      return {
        max: Math.min(base.max, 100) as FlightWarp,
        reason: 'Closing on the station: warp limited to 100×.',
      };
    if (r.phase === 'phasing' && view.toBurnS !== null && view.toBurnS < 300)
      return { max: MAX_FINE_WARP, reason: 'Transfer burn coming up: warp limited to 10×.' };
    return base;
  }

  private publish(): void {
    this.sincePublish = 0;
    const s = this.live;
    const lim =
      this.state.phase === 'proximity'
        ? {
            max: (this.prox?.maxWarp ?? 1) as FlightWarp,
            reason:
              this.prox?.state.phase === 'docked' ? null : 'Near the station: warp limited to 10×.',
          }
        : s
          ? this.limit(s)
          : { max: 1000 as FlightWarp, reason: null };
    this.set(
      {
        ...this.state,
        state: s,
        progress: this.progress,
        mode: this.mode,
        program: this.ps,
        manual: { ...this.manual },
        maxWarp: lim.max,
        warpLimitReason: lim.reason,
        warp: Math.min(this.state.warp, lim.max) as FlightWarp,
        message: this.message,
        station:
          this.eph && s ? { eph: this.eph, view: rendezvousView(this.rdv, s, this.eph) } : null,
        rendezvous: this.rdv,
        proximity: this.prox?.view() ?? null,
        lunar: this.lunar?.view(s) ?? null,
      },
      true,
    );
  }

  private set(next: FlightSnapshot, notify = true): void {
    this.state = next;
    if (!notify) return;
    this.snap = next;
    for (const l of this.listeners) l();
  }
}

export const PROGRAM_LABELS: Record<ProgramId, string> = {
  none: 'Autopilot off',
  circularize: 'Circularize',
  rendezvous: 'Rendezvous with station',
  deorbit: 'Deorbit to target',
  reentry: 'Re-entry guidance',
  landing: 'Landing burn',
  ...LUNAR_PROGRAM_LABELS,
};

/** Whether a program can be engaged now, with a player-readable reason if not. Pure. */
export function programAvailability(
  program: ProgramId,
  s: FlightState,
  p: FlightProgress,
  station: { dockingAdapter: boolean; stationRangeM: number | null } = {
    dockingAdapter: false,
    stationRangeM: null,
  },
  lunar: {
    env: GravityEnv;
    goal: LunarMissionPlan['goal'];
    inLunarOrbit: boolean;
  } | null = null,
): { ok: boolean; reason?: string } {
  if (s.phase !== 'flight') return { ok: false, reason: 'The ship is down.' };
  if (program === 'none') return { ok: true };
  if (isLunarProgram(program))
    return lunarProgramAvailability(
      program,
      s,
      lunar?.env ?? null,
      lunar?.goal ?? null,
      lunar?.inLunarOrbit ?? false,
    );
  if (s.ref === 'moon')
    return { ok: false, reason: 'Earth programs are unavailable near the Moon.' };
  const alt = localFrame(s.r).altitudeM;
  const el = orbitalElements(s.r, s.v);
  const noProp = s.propKg <= 0;
  switch (program) {
    case 'circularize':
      if (noProp) return { ok: false, reason: 'No propellant left for a burn.' };
      if (alt < 100_000)
        return { ok: false, reason: 'Too low to circularize: climb above 100 km first.' };
      if (el.status === 'orbit' && el.eccentricity < 0.003)
        return { ok: false, reason: 'The orbit is already circular.' };
      return { ok: true };
    case 'rendezvous':
      if (!station.dockingAdapter)
        return { ok: false, reason: 'Needs a docking adapter on the nose (station missions).' };
      if (noProp) return { ok: false, reason: 'No propellant left for rendezvous burns.' };
      if (!p.orbit) return { ok: false, reason: 'Reach a stable orbit first.' };
      if (station.stationRangeM !== null && station.stationRangeM < HANDOVER_RANGE_M)
        return { ok: false, reason: 'Already at the station: begin proximity operations.' };
      if (el.apoapsisAltM > STATION_RADIUS_M - EARTH_RADIUS_M + 50_000)
        return { ok: false, reason: 'The orbit is above the station: lower it first.' };
      return { ok: true };
    case 'deorbit':
      if (noProp) return { ok: false, reason: 'No propellant left for a deorbit burn.' };
      if (!p.orbit) return { ok: false, reason: 'Reach a stable orbit first.' };
      if (el.periapsisAltM < DEORBIT_PE_M)
        return { ok: false, reason: 'Already deorbited: use re-entry guidance.' };
      return { ok: true };
    case 'reentry':
      if (el.periapsisAltM > DEORBIT_PE_M && alt > 100_000)
        return { ok: false, reason: 'Not on a re-entry path: deorbit first.' };
      if (alt < 14_000)
        return { ok: false, reason: 'Below re-entry altitude: use the landing burn.' };
      return { ok: true };
    case 'landing':
      if (alt > 30_000) return { ok: false, reason: 'Landing guidance takes over below 30 km.' };
      if (noProp) return { ok: false, reason: 'No propellant left for a landing burn.' };
      return { ok: true };
  }
}
