import {
  approachMetrics,
  assistControls,
  DEPART_RANGE_M,
  initialProxState,
  NO_CONTROLS,
  stationTasks,
  stepProximity,
  taskProgress,
  undock,
  type ApproachMetrics,
  type AssistMode,
  type ProxControls,
  type ProxState,
  type StationTask,
  type Vec3,
} from './proximity';
import type { Relative3 } from './stationOrbit';

/*
 * One proximity-operations session near the station, from hand-over to departure. Owned and
 * stepped by the flight runtime (fixed steps); framework-free.
 */

export type ProxKey =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'pitch-up'
  | 'pitch-down'
  | 'yaw-left'
  | 'yaw-right'
  | 'roll-left'
  | 'roll-right';

export const PROX_WARP_LEVELS = [1, 2, 5, 10, 100, 1000] as const;
export type ProxWarp = (typeof PROX_WARP_LEVELS)[number];
/** Free flight near the station is limited to this warp; docked time can run faster. */
export const PROX_MAX_FREE_WARP: ProxWarp = 10;
/** The approach counts as manual if the assist wasn't used inside this distance of the port. */
const MANUAL_FINAL_M = 30;

export interface ProximityView {
  readonly state: ProxState;
  readonly metrics: ApproachMetrics;
  readonly assist: AssistMode;
  readonly hold: boolean;
  readonly align: boolean;
  readonly tasks: readonly StationTask[];
  readonly taskProgress: readonly number[];
  readonly tasksDone: boolean;
  readonly dockedS: number;
  readonly canDepart: boolean;
  readonly canUndock: boolean;
}

export class ProximitySession {
  private s: ProxState;
  private assist: AssistMode = 'off';
  private hold = true;
  /** Auto-align the nose with the port axis (attitude only; translation stays manual). */
  private align = false;
  private keys = new Set<ProxKey>();
  private dockedS = 0;
  private assistedFinal = false;
  readonly tasks: StationTask[];

  constructor(rel: Relative3, tS: number, hull: number, crew: number, cargo: boolean) {
    this.s = initialProxState(rel.p, rel.v, tS, hull);
    this.tasks = stationTasks(crew, cargo);
  }

  get state(): ProxState {
    return this.s;
  }

  view(): ProximityView {
    const progress = taskProgress(this.tasks, this.dockedS);
    const tasksDone = progress.every((p) => p >= 1);
    const m = approachMetrics(this.s);
    return {
      state: this.s,
      metrics: m,
      assist: this.assist,
      hold: this.hold,
      align: this.align,
      tasks: this.tasks,
      taskProgress: progress,
      tasksDone,
      dockedS: this.dockedS,
      canUndock: this.s.phase === 'docked' && tasksDone,
      canDepart: this.s.phase === 'free' && m.rangeM >= DEPART_RANGE_M,
    };
  }

  /** Highest time warp allowed now. */
  get maxWarp(): ProxWarp {
    return this.s.phase === 'docked' ? 1000 : PROX_MAX_FREE_WARP;
  }

  setAssist(mode: AssistMode): void {
    if (this.s.phase !== 'free') return;
    this.assist = mode;
  }

  setHold(on: boolean): void {
    this.hold = on;
    if (!on) this.align = false;
  }

  setAlign(on: boolean): void {
    this.align = on;
    if (on) this.hold = true;
  }

  setKey(key: ProxKey, down: boolean): void {
    if (down) {
      this.keys.add(key);
      // Manual input takes over from the assist (but an abort keeps flying).
      if (this.assist === 'dock') this.assist = 'off';
    } else this.keys.delete(key);
  }

  undock(): boolean {
    if (!this.view().canUndock) return false;
    this.s = undock(this.s);
    this.assist = 'off';
    return true;
  }

  step(dt: number): void {
    if (this.s.phase === 'docked') {
      this.dockedS += dt;
      this.s = { ...this.s, tS: this.s.tS + dt };
      return;
    }
    if (this.s.phase !== 'free') return;
    const m = approachMetrics(this.s);
    if (this.assist === 'dock' && m.alongM < MANUAL_FINAL_M && m.alongM > -1)
      this.assistedFinal = true;
    const controls =
      this.assist === 'off' ? this.manualControls() : assistControls(this.s, this.assist);
    const before = this.s.phase;
    this.s = stepProximity(this.s, controls, dt, !this.assistedFinal);
    if (before !== this.s.phase && this.s.phase === 'docked') {
      this.assist = 'off';
      this.keys.clear();
    }
    // An abort ends once the ship is safely outside the keep-out sphere.
    if (this.assist === 'abort' && approachMetrics(this.s).rangeM > DEPART_RANGE_M - 20) {
      const v = this.s.v;
      if (Math.hypot(v[0], v[1], v[2]) < 0.05) this.assist = 'off';
    }
  }

  private manualControls(): ProxControls {
    const k = (a: ProxKey, b: ProxKey) => (this.keys.has(a) ? 1 : 0) - (this.keys.has(b) ? 1 : 0);
    // Station axes: x radial (up), y along-track (the port faces +y, so "forward" is -y),
    // z cross-track (left is +z when facing the port).
    const translate: Vec3 = [k('up', 'down'), k('back', 'forward'), k('left', 'right')];
    const rotate: Vec3 = [
      k('pitch-up', 'pitch-down'),
      k('yaw-right', 'yaw-left'),
      k('roll-right', 'roll-left'),
    ];
    if (!translate.some((u) => u !== 0) && !rotate.some((u) => u !== 0))
      return { ...NO_CONTROLS, hold: this.hold, align: this.align };
    return { translate, rotate, hold: this.hold, align: this.align };
  }
}
