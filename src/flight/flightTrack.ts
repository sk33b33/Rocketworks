import type { FlightState } from './flightModel';

/*
 * Flight track and replay. The runtime records the ship's state as the player watched it (on a
 * real-time clock that stops while paused), so a replay shows the flight the way it was flown,
 * time warp included. Memory stays bounded: when the track is full every other sample is dropped
 * and the recording interval doubles. Framework-free and deterministic.
 */

/** Recording interval at the start of a flight (real seconds). */
export const TRACK_BASE_INTERVAL_S = 0.2;
/** Most samples kept; the track thins itself out beyond this. */
export const TRACK_MAX_SAMPLES = 3000;
export const REPLAY_SPEEDS = [1, 4, 16, 64] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface TrackSample {
  /** Recording clock (real seconds of unpaused flight). */
  readonly t: number;
  readonly s: FlightState;
  /** No interpolation from the previous sample (the ship was out of view in between). */
  readonly cut?: boolean;
}

export class FlightTrack {
  private list: TrackSample[] = [];
  private clock = 0;
  private sinceLast = Infinity;
  private interval = TRACK_BASE_INTERVAL_S;
  private pendingCut = false;

  get samples(): readonly TrackSample[] {
    return this.list;
  }
  get duration(): number {
    const n = this.list.length;
    return n > 1 ? this.list[n - 1]!.t - this.list[0]!.t : 0;
  }
  get intervalS(): number {
    return this.interval;
  }

  clear(): void {
    this.list = [];
    this.clock = 0;
    this.sinceLast = Infinity;
    this.interval = TRACK_BASE_INTERVAL_S;
    this.pendingCut = false;
  }

  /**
   * Advances the recording clock by `realDtS` and records `s` when it's due, or at once when the
   * flight phase or reference body changed. Pass null while the ship isn't shown in the Flight
   * view (the next sample then starts a new segment).
   */
  record(realDtS: number, s: FlightState | null): void {
    if (!s) {
      if (this.list.length) this.pendingCut = true;
      return;
    }
    this.clock += Math.max(0, realDtS);
    this.sinceLast += Math.max(0, realDtS);
    const last = this.list[this.list.length - 1];
    if (last && last.s === s) return;
    const changed = !!last && (last.s.phase !== s.phase || last.s.ref !== s.ref);
    if (!changed && !this.pendingCut && this.sinceLast < this.interval) return;
    this.list.push(this.pendingCut ? { t: this.clock, s, cut: true } : { t: this.clock, s });
    this.pendingCut = false;
    this.sinceLast = 0;
    if (this.list.length > TRACK_MAX_SAMPLES) this.thin();
  }

  /** Drops every other sample (keeping the first, the last and segment starts). */
  private thin(): void {
    const n = this.list.length;
    this.list = this.list.filter((x, i) => i % 2 === 0 || i === n - 1 || !!x.cut);
    this.interval *= 2;
  }

  /** Ship state at recording time `t` (clamped to the track; null when empty). */
  stateAt(t: number): FlightState | null {
    const list = this.list;
    if (!list.length) return null;
    if (t <= list[0]!.t) return list[0]!.s;
    const last = list[list.length - 1]!;
    if (t >= last.t) return last.s;
    let lo = 0;
    let hi = list.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    const a = list[lo]!;
    const b = list[hi]!;
    if (b.cut) return a.s;
    return interpolateState(a.s, b.s, (t - a.t) / Math.max(1e-9, b.t - a.t));
  }
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** Shortest-way interpolation of an angle in degrees. */
const lerpDeg = (a: number, b: number, f: number) =>
  a + (((((b - a + 540) % 360) + 360) % 360) - 180) * f;

/**
 * State between two samples. Position and velocity follow a cubic Hermite curve through both
 * samples' positions and velocities (a good fit to an orbital arc even far apart in sim time),
 * with the radius blended linearly;
 * attitude and gauges are blended; anything discrete comes from the earlier sample. Pure.
 */
export function interpolateState(a: FlightState, b: FlightState, f: number): FlightState {
  const u = Math.min(1, Math.max(0, f));
  if (a.phase !== b.phase || a.ref !== b.ref || a.origin !== b.origin) return u < 1 ? a : b;
  const dt = b.tS - a.tS;
  if (!(dt > 0)) return u < 0.5 ? a : b;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  // Derivatives of the basis with respect to u.
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  const axis = (i: 0 | 1) => {
    const p0 = a.r[i];
    const p1 = b.r[i];
    const m0 = a.v[i] * dt;
    const m1 = b.v[i] * dt;
    return {
      p: h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1,
      v: (d00 * p0 + d10 * m0 + d01 * p1 + d11 * m1) / dt,
    };
  };
  const x = axis(0);
  const y = axis(1);
  // Keep the distance from the body's centre on a straight blend: on a coarse track the cubic
  // alone cuts a little inside a long orbital arc.
  const want = lerp(Math.hypot(a.r[0], a.r[1]), Math.hypot(b.r[0], b.r[1]), u);
  const got = Math.hypot(x.p, y.p);
  const k = got > 1 ? want / got : 1;
  return {
    ...a,
    tS: lerp(a.tS, b.tS, u),
    r: [x.p * k, y.p * k],
    v: [x.v, y.v],
    propKg: lerp(a.propKg, b.propKg, u),
    pitchDeg: lerpDeg(a.pitchDeg, b.pitchDeg, u),
    bankDeg: lerpDeg(a.bankDeg, b.bankDeg, u),
    yawDeg: lerpDeg(a.yawDeg, b.yawDeg, u),
    throttle: lerp(a.throttle, b.throttle, u),
    hull: lerp(a.hull, b.hull, u),
    shield: lerp(a.shield, b.shield, u),
    heatFluxWm2: lerp(a.heatFluxWm2, b.heatFluxWm2, u),
    gLoad: lerp(a.gLoad, b.gLoad, u),
    angleOfAttackDeg: lerpDeg(a.angleOfAttackDeg, b.angleOfAttackDeg, u),
  };
}

export interface ReplayView {
  /** Playback position on the recording clock, from 0 to `duration`. */
  readonly t: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  /** Mission time of the replayed state (s). */
  readonly missionTimeS: number;
}

/** Plays a recorded track back. The UI subscribes to throttled views. */
export class ReplayPlayer {
  private view: ReplayView | null = null;
  private current: FlightState | null = null;
  private sincePublish = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly track: FlightTrack) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): ReplayView | null => this.view;

  get active(): boolean {
    return !!this.view;
  }
  /** The replayed ship state (null when not replaying). */
  get state(): FlightState | null {
    return this.current;
  }

  /** Whether there is enough of a track to replay, with a reason if not. */
  availability(): { ok: boolean; reason?: string } {
    if (this.track.samples.length < 2 || this.track.duration < 1)
      return { ok: false, reason: 'Nothing was recorded on this flight in the Flight view.' };
    return { ok: true };
  }

  start(speed: ReplaySpeed = 4): boolean {
    if (!this.availability().ok) return false;
    this.seek(0, { playing: true, speed });
    return true;
  }

  stop(): void {
    if (!this.view) return;
    this.view = null;
    this.current = null;
    this.emit();
  }

  togglePlay(): void {
    const v = this.view;
    if (!v) return;
    // Playing again from the end starts over.
    const t = !v.playing && v.t >= v.duration ? 0 : v.t;
    this.seek(t, { playing: !v.playing });
  }

  setSpeed(speed: ReplaySpeed): void {
    if (this.view) this.seek(this.view.t, { speed });
  }

  /** Moves playback to recording time `t` (seconds from the start of the track). */
  seek(t: number, patch: Partial<Pick<ReplayView, 'playing' | 'speed'>> = {}): void {
    const duration = this.track.duration;
    const t0 = this.track.samples[0]?.t ?? 0;
    const clamped = Math.min(duration, Math.max(0, t));
    this.current = this.track.stateAt(t0 + clamped);
    this.view = {
      t: clamped,
      duration,
      playing: patch.playing ?? this.view?.playing ?? false,
      speed: patch.speed ?? this.view?.speed ?? 4,
      missionTimeS: this.current?.tS ?? 0,
    };
    this.emit();
  }

  /** Advances playback by `realDtS` (called every frame while replaying). */
  update(realDtS: number): void {
    const v = this.view;
    if (!v || !v.playing) return;
    const t = Math.min(v.duration, v.t + Math.max(0, realDtS) * v.speed);
    const t0 = this.track.samples[0]?.t ?? 0;
    this.current = this.track.stateAt(t0 + t);
    const playing = t < v.duration;
    this.view = { ...v, t, playing, missionTimeS: this.current?.tS ?? 0 };
    this.sincePublish += realDtS;
    if (this.sincePublish >= 0.1 || !playing) this.emit();
  }

  private emit(): void {
    this.sincePublish = 0;
    for (const l of this.listeners) l();
  }
}
