import { MAX_STEPS_PER_FRAME, SIM_DT_S } from '../simulation/constants';
import {
  abortAscent,
  initialAscentState,
  isTerminal,
  stepAscent,
  type AscentConfig,
  type AscentState,
} from '../simulation/ascent/ascentModel';
import type { RocketBlueprint } from '../rocket/model/types';
import { advanceCountdown, COUNTDOWN_START_S, TERMINAL_COUNT_S } from './countdown';
import {
  ascentRecord,
  scrubRecord,
  type BoosterRecoverySummary,
  type FlightRecord,
  type OutcomeInput,
} from './flightRecord';
import {
  recoveryAvailability,
  type BoosterSpec,
  type RecoveryTarget,
} from '../recovery/recoveryPlan';
import {
  RecoverySession,
  unrecoveredSummary,
  type BoosterKey,
  type RecoverySessionView,
} from '../recovery/recoverySession';

/*
 * Launch runtime: a framework-free state machine for one launch attempt
 * (rollout → pad → countdown → ascent → [booster recovery replay] → debrief, or → handoff when
 * an orbital mission reaches orbit and continues in the Flight runtime). The scene calls update() every frame; the
 * simulation advances in fixed SIM_DT_S steps (capped per frame) and can be paused or warped.
 * UI subscribes to throttled immutable snapshots, so React never re-renders at frame rate.
 */

export type LaunchPhase =
  'idle' | 'rollout' | 'pad' | 'countdown' | 'ascent' | 'recovery' | 'handoff' | 'debrief';
export const WARP_LEVELS = [1, 2, 4, 10] as const;
export type Warp = (typeof WARP_LEVELS)[number];

/** Real seconds for the rollout animation. */
export const ROLLOUT_DURATION_S = 20;
/** Real seconds to linger on the final state before the debrief opens. */
export const DEBRIEF_DELAY_S = 4;
/** Real seconds after orbit insertion before the "continue to orbit" hand-off is offered. */
export const HANDOFF_DELAY_S = 2;
const PUBLISH_INTERVAL_S = 0.1;
const PROFILE_SAMPLE_S = 2;

export interface LaunchContext {
  readonly outcome: OutcomeInput;
  readonly blueprint: RocketBlueprint;
  readonly designRevision: number;
  readonly crewed: boolean;
  readonly crewNames: readonly string[];
  readonly config: AscentConfig;
  /** Booster recovery plan (absent = expend). */
  readonly recovery?: RecoveryTarget;
  readonly boosterSpec?: BoosterSpec;
  /** Fleet vehicles flying (null = new build). */
  readonly hardware?: { readonly boosterId: string | null; readonly shipId: string | null };
}

export interface LaunchSnapshot {
  readonly phase: LaunchPhase;
  readonly context: LaunchContext | null;
  readonly rolloutProgress: number;
  readonly clockS: number;
  readonly held: boolean;
  readonly paused: boolean;
  readonly warp: Warp;
  readonly ascent: AscentState | null;
  /** Altitude/downrange samples for the ascent profile chart. */
  readonly profile: readonly { readonly x: number; readonly h: number }[];
  readonly record: FlightRecord | null;
  /** Live booster recovery replay (during and after the 'recovery' phase). */
  readonly recovery: RecoverySessionView | null;
  readonly recoveryResult: BoosterRecoverySummary | null;
}

const IDLE: LaunchSnapshot = {
  phase: 'idle',
  context: null,
  rolloutProgress: 0,
  clockS: COUNTDOWN_START_S,
  held: false,
  paused: false,
  warp: 1,
  ascent: null,
  profile: [],
  record: null,
  recovery: null,
  recoveryResult: null,
};

export class LaunchRuntime {
  /** Working state, updated every frame (read by the renderer via `current`). */
  private state: LaunchSnapshot = IDLE;
  /** Last published state (what the UI sees); replaced only on publish. */
  private snap: LaunchSnapshot = IDLE;
  /** Live ascent state (updated every step; published to the UI at a throttled rate). */
  private live: AscentState | null = null;
  private session: RecoverySession | null = null;
  private skipped = false;
  private sinceRecoveryDone = 0;
  private accumulator = 0;
  private sincePublish = 0;
  private sinceTerminal = 0;
  private sinceContinuous = 0;
  private lastSample = -Infinity;
  private profile: { x: number; h: number }[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly onRecord: (record: FlightRecord) => void,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // ---- subscription (useSyncExternalStore-compatible) ----
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): LaunchSnapshot => this.snap;

  /** Latest ascent state for rendering (may be newer than the published snapshot). */
  get liveAscent(): AscentState | null {
    return this.live;
  }

  /** Latest working state for rendering (rollout progress, clock); not throttled. */
  get current(): LaunchSnapshot {
    return this.state;
  }

  // ---- commands ----
  prepare(context: LaunchContext, skipRollout = false): void {
    this.live = null;
    this.session = null;
    this.accumulator = 0;
    this.profile = [];
    this.lastSample = -Infinity;
    this.sinceTerminal = 0;
    this.set({
      ...IDLE,
      phase: skipRollout ? 'pad' : 'rollout',
      rolloutProgress: skipRollout ? 1 : 0,
      context,
    });
  }

  reset(): void {
    this.live = null;
    this.session = null;
    this.set(IDLE);
  }

  skipRollout(): void {
    if (this.state.phase === 'rollout')
      this.set({ ...this.state, phase: 'pad', rolloutProgress: 1 });
  }

  startCountdown(): void {
    if (this.state.phase !== 'pad') return;
    this.set({ ...this.state, phase: 'countdown', clockS: COUNTDOWN_START_S, held: false });
  }

  hold(): void {
    if (this.state.phase === 'countdown') this.set({ ...this.state, held: true });
  }

  resume(): void {
    if (this.state.phase === 'countdown') this.set({ ...this.state, held: false });
  }

  skipToTerminalCount(): void {
    if (this.state.phase === 'countdown' && this.state.clockS < TERMINAL_COUNT_S) {
      this.set({ ...this.state, clockS: TERMINAL_COUNT_S });
    }
  }

  /** Countdown: scrub (no penalty). Ascent: abort the flight. */
  abort(reason = 'Scrubbed by the launch director.'): void {
    const { phase, context } = this.state;
    if (!context) return;
    if (phase === 'countdown' || phase === 'pad') {
      const record = scrubRecord({ ...context.outcome, at: this.now() }, reason);
      this.set({ ...this.state, phase: 'debrief', record });
      this.onRecord(record);
    } else if (phase === 'ascent' && this.live && !isTerminal(this.live.status)) {
      this.live = abortAscent(this.live, context.crewed);
      this.publish();
    }
  }

  togglePause(): void {
    if (this.state.phase === 'ascent' || this.state.phase === 'recovery')
      this.set({ ...this.state, paused: !this.state.paused });
  }

  /** Live booster recovery session (for rendering). */
  get liveRecovery(): RecoverySessionView | null {
    return this.session?.view() ?? null;
  }

  get manualLandingAvailable(): boolean {
    return !!this.session?.manualAvailable;
  }

  /** Hands the booster's landing burn to the player (or back to the assist). */
  setManualLanding(on: boolean): void {
    if (this.state.phase !== 'recovery' || !this.session) return;
    this.session.setManual(on);
    this.publishRecovery();
  }

  setBoosterKey(key: BoosterKey, down: boolean): void {
    this.session?.setKey(key, down);
  }

  setBoosterThrottle(t: number): void {
    this.session?.setThrottle(t);
  }

  /** Skips the recovery replay; the assisted result is simulated. */
  skipRecovery(): void {
    if (this.state.phase !== 'recovery' || !this.session || this.session.done) return;
    this.session.skip();
    this.skipped = true;
    this.sinceRecoveryDone = DEBRIEF_DELAY_S;
    this.publishRecovery();
  }

  setWarp(warp: Warp): void {
    if (this.session?.view().manualActive) return; // manual landings fly in real time
    this.set({ ...this.state, warp });
  }

  // ---- per-frame update ----
  update(realDtS: number): void {
    const s = this.state;
    switch (s.phase) {
      case 'rollout': {
        const p = Math.min(1, s.rolloutProgress + realDtS / ROLLOUT_DURATION_S);
        this.set({ ...s, rolloutProgress: p, phase: p >= 1 ? 'pad' : 'rollout' }, p < 1, realDtS);
        break;
      }
      case 'countdown': {
        if (s.held) return;
        const clockS = advanceCountdown(s.clockS, realDtS);
        if (clockS >= 0 && s.context) {
          this.live = initialAscentState(s.context.config.vehicle);
          this.set({ ...s, clockS: 0, phase: 'ascent', ascent: this.live });
        } else {
          this.set({ ...s, clockS }, true, realDtS);
        }
        break;
      }
      case 'ascent':
        this.updateAscent(realDtS);
        break;
      case 'recovery':
        this.updateRecovery(realDtS);
        break;
      default:
        break;
    }
  }

  private updateAscent(realDtS: number): void {
    const s = this.state;
    const ctx = s.context;
    if (!ctx || !this.live || s.paused) return;
    if (!isTerminal(this.live.status)) {
      this.accumulator += realDtS * s.warp;
      let steps = 0;
      const eventsBefore = this.live.events.length;
      while (
        this.accumulator >= SIM_DT_S &&
        steps < MAX_STEPS_PER_FRAME &&
        !isTerminal(this.live.status)
      ) {
        this.live = stepAscent(this.live, ctx.config, SIM_DT_S);
        this.accumulator -= SIM_DT_S;
        steps++;
        if (this.live.tS - this.lastSample >= PROFILE_SAMPLE_S) {
          this.profile.push({ x: this.live.downrangeM, h: this.live.altitudeM });
          this.lastSample = this.live.tS;
        }
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0; // drop backlog instead of spiralling
      this.sincePublish += realDtS;
      if (
        this.live.events.length !== eventsBefore ||
        isTerminal(this.live.status) ||
        this.sincePublish >= PUBLISH_INTERVAL_S
      ) {
        this.publish();
      }
      return;
    }
    // Terminal: linger on the final state, then recover the booster (or wrap up).
    this.sinceTerminal += realDtS;
    const success = this.live.status === 'orbit' || this.live.status === 'apogee';
    if (this.sinceTerminal < (success ? HANDOFF_DELAY_S : DEBRIEF_DELAY_S) || s.record) return;
    const target = ctx.recovery ?? 'expend';
    const staging = this.live.staging;
    if (target === 'expend') return this.finishLaunch(unrecoveredSummary('expend', 'expended'));
    const spec = ctx.boosterSpec;
    if (!success || !staging || !spec || !recoveryAvailability(target, spec.hardware).ok)
      return this.finishLaunch(unrecoveredSummary(target, 'not-attempted'));
    this.session = new RecoverySession(staging, spec, target);
    this.skipped = false;
    this.sinceRecoveryDone = 0;
    this.accumulator = 0;
    this.set({
      ...this.state,
      phase: 'recovery',
      ascent: this.live,
      recovery: this.session.view(),
    });
  }

  private updateRecovery(realDtS: number): void {
    const session = this.session;
    if (!session || this.state.paused) return;
    if (!session.done) {
      // A manual landing flies in real time.
      if (session.view().manualActive && this.state.warp > 1)
        this.state = { ...this.state, warp: 1 };
      this.accumulator += realDtS * this.state.warp;
      const eventsBefore = session.view().state.events.length;
      const stepReal = SIM_DT_S / this.state.warp;
      let steps = 0;
      while (this.accumulator >= SIM_DT_S && steps < MAX_STEPS_PER_FRAME && !session.done) {
        session.step(SIM_DT_S, stepReal);
        this.accumulator -= SIM_DT_S;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.sincePublish += realDtS;
      if (
        session.view().state.events.length !== eventsBefore ||
        session.done ||
        this.sincePublish >= PUBLISH_INTERVAL_S
      )
        this.publishRecovery();
      return;
    }
    this.sinceRecoveryDone += realDtS;
    if (
      this.sinceRecoveryDone >= DEBRIEF_DELAY_S &&
      !this.state.record &&
      this.state.phase === 'recovery'
    )
      this.finishLaunch(session.summary(this.skipped));
  }

  /** Ends the launch session: hand-off to orbit or debrief with the flight record. */
  private finishLaunch(recovery: BoosterRecoverySummary): void {
    const ctx = this.state.context;
    const live = this.live;
    if (!ctx || !live) return;
    if (continuesInOrbit(ctx, live)) {
      // The flight isn't over: the Flight runtime takes the ship from here.
      this.set({ ...this.state, phase: 'handoff', ascent: live, recoveryResult: recovery });
      return;
    }
    const record: FlightRecord = {
      ...ascentRecord({ ...ctx.outcome, at: this.now() }, live),
      recovery,
      hardware: ctx.hardware ?? { boosterId: null, shipId: null },
    };
    this.set({ ...this.state, phase: 'debrief', record, ascent: live, recoveryResult: recovery });
    this.onRecord(record);
  }

  private publishRecovery(): void {
    this.sincePublish = 0;
    this.set({ ...this.state, recovery: this.session?.view() ?? null });
  }

  /** Ends the launch session after the orbital flight has been recorded. */
  completeHandoff(): void {
    if (this.state.phase === 'handoff') this.reset();
  }

  private publish(): void {
    this.sincePublish = 0;
    this.set({ ...this.state, ascent: this.live, profile: [...this.profile] });
  }

  /**
   * Replaces the working state. Discrete changes publish immediately; `continuous` changes
   * (rollout progress, countdown clock) publish at most every PUBLISH_INTERVAL_S.
   */
  private set(next: LaunchSnapshot, continuous = false, realDtS = 0): void {
    this.state = next;
    if (continuous) {
      this.sinceContinuous += realDtS;
      if (this.sinceContinuous < PUBLISH_INTERVAL_S) return;
    }
    this.sinceContinuous = 0;
    this.snap = next;
    for (const l of this.listeners) l();
  }
}

/** Orbital missions that reached orbit continue in the Flight runtime instead of a debrief. */
export function continuesInOrbit(ctx: LaunchContext, s: AscentState): boolean {
  return ctx.config.target.kind === 'orbit' && s.status === 'orbit';
}
