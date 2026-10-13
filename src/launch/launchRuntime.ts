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
import { ascentRecord, scrubRecord, type FlightRecord, type OutcomeInput } from './flightRecord';

/*
 * Launch runtime: a framework-free state machine for one launch attempt
 * (rollout → pad → countdown → ascent → debrief). The scene calls update() every frame; the
 * simulation advances in fixed SIM_DT_S steps (capped per frame) and can be paused or warped.
 * UI subscribes to throttled immutable snapshots, so React never re-renders at frame rate.
 */

export type LaunchPhase = 'idle' | 'rollout' | 'pad' | 'countdown' | 'ascent' | 'debrief';
export const WARP_LEVELS = [1, 2, 4, 10] as const;
export type Warp = (typeof WARP_LEVELS)[number];

/** Real seconds for the rollout animation. */
export const ROLLOUT_DURATION_S = 20;
/** Real seconds to linger on the final state before the debrief opens. */
export const DEBRIEF_DELAY_S = 4;
const PUBLISH_INTERVAL_S = 0.1;
const PROFILE_SAMPLE_S = 2;

export interface LaunchContext {
  readonly outcome: OutcomeInput;
  readonly blueprint: RocketBlueprint;
  readonly designRevision: number;
  readonly crewed: boolean;
  readonly crewNames: readonly string[];
  readonly config: AscentConfig;
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
};

export class LaunchRuntime {
  /** Working state, updated every frame (read by the renderer via `current`). */
  private state: LaunchSnapshot = IDLE;
  /** Last published state (what the UI sees); replaced only on publish. */
  private snap: LaunchSnapshot = IDLE;
  /** Live ascent state (updated every step; published to the UI at a throttled rate). */
  private live: AscentState | null = null;
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
    if (this.state.phase === 'ascent') this.set({ ...this.state, paused: !this.state.paused });
  }

  setWarp(warp: Warp): void {
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
    // Terminal: keep the booster falling for the visuals, then open the debrief.
    this.sinceTerminal += realDtS;
    if (this.sinceTerminal >= DEBRIEF_DELAY_S && !s.record) {
      const record = ascentRecord({ ...ctx.outcome, at: this.now() }, this.live);
      this.set({ ...this.state, phase: 'debrief', record, ascent: this.live });
      this.onRecord(record);
    }
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
