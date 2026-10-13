import { MAX_STEPS_PER_FRAME } from '../simulation/constants';
import type { FlightRecord, OutcomeInput } from '../launch/flightRecord';
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

/*
 * Flight runtime: one orbital flight session from orbit insertion to touchdown. Framework-free
 * like LaunchRuntime: the scene calls update() every frame, the simulation advances in fixed
 * steps (finer in the atmosphere or under thrust, coarse only for unpowered coasting in space),
 * and the UI subscribes to throttled snapshots.
 */

export type FlightSessionPhase = 'idle' | 'flight' | 'debrief';
export const FLIGHT_WARP_LEVELS = [1, 2, 5, 10, 50, 100, 500, 1000] as const;
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
    this.set({ ...IDLE, phase: 'flight', context, zone: this.state.zone }, true);
  }

  reset(): void {
    this.live = null;
    this.keys.clear();
    this.set({ ...IDLE, zone: this.state.zone });
  }

  togglePause(): void {
    if (this.state.phase === 'flight') this.set({ ...this.state, paused: !this.state.paused });
  }

  setWarp(warp: FlightWarp): void {
    if (this.state.phase !== 'flight') return;
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
    const check = programAvailability(program, s, this.progress);
    if (!check.ok) {
      this.message = check.reason ?? null;
      this.publish();
      return check;
    }
    this.ps = program === 'none' ? IDLE_PROGRAM : { ...IDLE_PROGRAM, program };
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
      if (message) this.message = message;
    }
  }

  // ---- per-frame update ----

  update(realDtS: number): void {
    const st = this.state;
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
      const lim = warpLimit(
        this.live,
        this.ps,
        this.ps.program === 'none' ? this.manual.throttle : 0,
      );
      const dt = st.warp > MAX_FINE_WARP && lim.max > MAX_FINE_WARP ? COARSE_DT_S : FINE_DT_S;
      if (this.accumulator < dt) break;
      this.step(spec, dt);
      this.accumulator -= dt;
      steps++;
      // Drop to an allowed warp as soon as a limit applies (e.g. approaching a burn).
      const after = warpLimit(
        this.live,
        this.ps,
        this.ps.program === 'none' ? this.manual.throttle : 0,
      );
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
    if (this.ps.program !== 'none') {
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
    const next = stepFlight(s, spec, controls, dt);
    this.live = next;
    this.track(s, next);
  }

  /** Objective tracking after each step. */
  private track(prev: FlightState, s: FlightState): void {
    const f = localFrame(s.r);
    const el = orbitalElements(s.r, s.v);
    this.maxAltitudeM = Math.max(this.maxAltitudeM, f.altitudeM);
    this.maxSpeedMS = Math.max(this.maxSpeedMS, len(s.v));
    const dA = wrapAngle(f.groundAngle - this.lastAngle);
    this.lastAngle = f.groundAngle;
    let p = this.progress;
    const notes: FlightEvent[] = [];
    if (!p.orbit && el.status === 'orbit') {
      p = { ...p, orbit: true, travelSinceOrbit: 0 };
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
    if (p.orbit && !p.deorbit && el.periapsisAltM < DEORBIT_PE_M) {
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

  private publish(): void {
    this.sincePublish = 0;
    const s = this.live;
    const lim = s
      ? warpLimit(s, this.ps, this.ps.program === 'none' ? this.manual.throttle : 0)
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
  deorbit: 'Deorbit to target',
  reentry: 'Re-entry guidance',
  landing: 'Landing burn',
};

/** Whether a program can be engaged now, with a player-readable reason if not. Pure. */
export function programAvailability(
  program: ProgramId,
  s: FlightState,
  p: FlightProgress,
): { ok: boolean; reason?: string } {
  if (s.phase !== 'flight') return { ok: false, reason: 'The ship is down.' };
  if (program === 'none') return { ok: true };
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
