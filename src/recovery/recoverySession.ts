import type { BoosterRecoverySummary } from '../launch/flightRecord';
import type { StagingSnapshot } from '../simulation/ascent/ascentModel';
import {
  contactMetrics,
  initialBoosterState,
  stepBooster,
  type BoosterState,
  type RecoveryTargetSpec,
} from './boosterModel';
import {
  GUIDANCE_LABELS,
  guideBooster,
  initialGuidance,
  planPlatformX,
  REC,
  type GuidancePhase,
  type GuidanceState,
  type ManualLandingInput,
} from './boosterGuidance';
import { rateLanding, type Grade } from './rating';
import {
  BOOSTER_TOUCHDOWN,
  CATCH_HEIGHT_M,
  CATCH_WINDOW,
  PLATFORM_HALF_DECK_M,
  type BoosterSpec,
  type RecoveryTarget,
} from './recoveryPlan';

/*
 * One booster recovery attempt, replayed from staging. Framework-free: the launch runtime steps
 * it at a fixed rate. The player can hand the landing burn to themselves (manual throttle and
 * tilt) for a bonus, or skip the replay (the assisted result is simulated instantly).
 */

export type BoosterKey = 'throttle-up' | 'throttle-down' | 'tilt-downrange' | 'tilt-uprange';

/** Fixed step used when the replay is skipped (same as the live replay). */
const SKIP_DT_S = 0.05;

export const MANUAL_RATES = { throttlePerS: 0.8, tiltDegPerS: 12, maxTiltDeg: 20 } as const;

export interface RecoverySessionView {
  readonly state: BoosterState;
  readonly phase: GuidancePhase;
  readonly phaseLabel: string;
  readonly target: RecoveryTargetSpec;
  readonly manualRequested: boolean;
  /** The player is flying right now. */
  readonly manualActive: boolean;
  readonly manualInput: ManualLandingInput;
  readonly done: boolean;
  /** Height above the target (catch height or deck). */
  readonly heightAboveM: number;
}

export class RecoverySession {
  private s: BoosterState;
  private g: GuidanceState;
  private manualRequested = false;
  private input: { throttle: number; tiltDeg: number } = { throttle: 0, tiltDeg: 0 };
  private keys = new Set<BoosterKey>();
  private wasManual = false;
  /** The assist flew part of the landing burn (then it doesn't count as a manual landing). */
  private assistedBurn = false;
  private message: string | null = null;
  readonly target: RecoveryTargetSpec;

  constructor(
    staging: StagingSnapshot,
    readonly spec: BoosterSpec,
    readonly mode: Exclude<RecoveryTarget, 'expend'>,
  ) {
    this.s = initialBoosterState(staging, spec);
    this.g = initialGuidance(this.s.tS);
    this.target = { mode, x: mode === 'catch' ? 0 : planPlatformX(this.s, spec) };
  }

  get done(): boolean {
    return this.s.phase !== 'flight';
  }

  get lastMessage(): string | null {
    return this.message;
  }

  /** Manual landing is offered once the booster is in its final descent. */
  get manualAvailable(): boolean {
    return (
      !this.done &&
      (this.g.phase === 'glide' || this.g.phase === 'landing-burn') &&
      this.s.h - targetHeight(this.target) < REC.manualFromM
    );
  }

  view(): RecoverySessionView {
    const manualActive = this.manualRequested && this.g.phase === 'landing-burn';
    return {
      state: this.s,
      phase: this.g.phase,
      phaseLabel: GUIDANCE_LABELS[this.g.phase],
      target: this.target,
      manualRequested: this.manualRequested,
      manualActive,
      manualInput: { ...this.input },
      done: this.done,
      heightAboveM: this.s.h - targetHeight(this.target),
    };
  }

  setManual(on: boolean): void {
    this.manualRequested = on;
    // Pick up from the current thrust: three engines map to 1/3..1, one engine to 0..1/3.
    if (on) {
      const t = this.s.enginesLit > 1 ? this.s.throttle : this.s.throttle / 3;
      this.input = { throttle: t, tiltDeg: 0 };
    }
  }

  setKey(key: BoosterKey, down: boolean): void {
    if (down) this.keys.add(key);
    else this.keys.delete(key);
  }

  setThrottle(t: number): void {
    this.input = { ...this.input, throttle: Math.max(0, Math.min(1, t)) };
  }

  /** Advances one fixed step. `realDtS` drives the manual key rates. */
  step(dt: number, realDtS: number): void {
    if (this.done) return;
    if (this.manualRequested && this.keys.size) this.applyKeys(realDtS);
    const landingManual = this.manualRequested && this.g.phase === 'landing-burn';
    // The player may only take over in the final descent: before that the assist flies.
    const manual = landingManual ? this.input : null;
    if (landingManual) this.wasManual = true;
    else if (this.g.phase === 'landing-burn') this.assistedBurn = true;
    const out = guideBooster(this.g, this.s, this.spec, this.target, manual);
    if (out.message) this.message = out.message;
    // Taking over at ignition: start from the throttle the assist would have used.
    if (
      this.manualRequested &&
      this.g.phase !== 'landing-burn' &&
      out.next.phase === 'landing-burn'
    )
      this.input = { throttle: 1, tiltDeg: 0 };
    this.g = out.next;
    this.s = stepBooster(this.s, this.spec, out.controls, this.target, dt);
  }

  /** Skips the replay: the assist flies the rest of the recovery instantly. */
  skip(): void {
    this.manualRequested = false;
    for (let i = 0; i < 60_000 && !this.done; i++) this.step(SKIP_DT_S, 0);
  }

  summary(simulated: boolean): BoosterRecoverySummary {
    // Credit a manual landing only if the player flew the whole landing burn.
    return summarizeRecovery(this.s, this.target, this.wasManual && !this.assistedBurn, simulated);
  }

  private applyKeys(dt: number): void {
    let { throttle, tiltDeg } = this.input;
    if (this.keys.has('throttle-up')) throttle += MANUAL_RATES.throttlePerS * dt;
    if (this.keys.has('throttle-down')) throttle -= MANUAL_RATES.throttlePerS * dt;
    if (this.keys.has('tilt-downrange')) tiltDeg += MANUAL_RATES.tiltDegPerS * dt;
    if (this.keys.has('tilt-uprange')) tiltDeg -= MANUAL_RATES.tiltDegPerS * dt;
    this.input = {
      throttle: Math.max(0, Math.min(1, throttle)),
      tiltDeg: Math.max(-MANUAL_RATES.maxTiltDeg, Math.min(MANUAL_RATES.maxTiltDeg, tiltDeg)),
    };
  }
}

function targetHeight(t: RecoveryTargetSpec): number {
  return t.mode === 'catch' ? CATCH_HEIGHT_M : 0;
}

/** Outcome, metrics and rating of a finished recovery. Pure. */
export function summarizeRecovery(
  s: BoosterState,
  target: RecoveryTargetSpec,
  manual: boolean,
  simulated: boolean,
): BoosterRecoverySummary {
  const m = contactMetrics(s, target.x);
  const last = [...s.events].reverse().find((e) => e.kind === 'success' || e.kind === 'fail');
  const success = s.phase === 'caught' || s.phase === 'landed';
  const metrics = s.contact ?? m;
  let grade: Grade | null = null;
  if (success) {
    grade = rateLanding(
      metrics,
      s.phase === 'caught' ? CATCH_WINDOW : { ...BOOSTER_TOUCHDOWN, missM: PLATFORM_HALF_DECK_M },
    ).grade;
  }
  return {
    target: target.mode,
    outcome: s.phase === 'caught' ? 'caught' : s.phase === 'landed' ? 'landed' : 'lost',
    grade,
    manual,
    simulated,
    missM: success ? metrics.missM : s.phase === 'flight' ? null : m.missM,
    vertMS: success ? metrics.vertMS : null,
    heatLoadMJm2: s.heatLoadJm2 / 1e6,
    summary: last?.text ?? (success ? 'Booster recovered.' : 'Booster lost.'),
  };
}

/** Recovery summary for a booster that was expended or never got to try. */
export function unrecoveredSummary(
  target: RecoveryTarget,
  reason: 'expended' | 'not-attempted',
): BoosterRecoverySummary {
  return {
    target,
    outcome: reason,
    grade: null,
    manual: false,
    simulated: false,
    missM: null,
    vertMS: null,
    heatLoadMJm2: 0,
    summary:
      reason === 'expended'
        ? 'Booster expended by plan: it fell into the ocean downrange.'
        : 'Booster recovery was not attempted: the flight did not reach staging cleanly.',
  };
}
