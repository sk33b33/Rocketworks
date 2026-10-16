/*
 * What the game should sound like right now, as plain numbers: engine roar, wind, room hum, and
 * one-shot cues detected from state changes. Pure and deterministic, so the audio engine only
 * turns these into Web Audio parameters. Game values, tuned by ear, not acoustics.
 */

/** Where the listener is, for the room tone. */
export type SoundRoom =
  'factory' | 'mission-control' | 'launch-pad' | 'station' | 'space' | 'surface' | 'quiet';

export interface SoundInputs {
  readonly room: SoundRoom;
  /** Engine output 0..1 (throttle with engines lit; 0 when off). */
  readonly thrust: number;
  /** The big booster is firing (a deeper, heavier roar). */
  readonly heavy: boolean;
  /** No air to carry the sound (only what comes through the structure). */
  readonly vacuum: boolean;
  /** Dynamic pressure (Pa) and heating (W/m²): wind, buffeting and the plasma roar. */
  readonly qPa: number;
  readonly heatWm2: number;
  /** Time stopped or racing: the continuous sounds go quiet. */
  readonly paused: boolean;
  readonly warp: number;
}

export const SILENT_INPUTS: SoundInputs = {
  room: 'quiet',
  thrust: 0,
  heavy: false,
  vacuum: false,
  qPa: 0,
  heatWm2: 0,
  paused: false,
  warp: 1,
};

export interface SoundMix {
  /** Gains 0..1 and filter frequencies (Hz). */
  readonly engine: number;
  readonly engineHz: number;
  readonly rumble: number;
  readonly wind: number;
  readonly windHz: number;
  readonly hum: number;
}

/** Above this warp, continuous sounds fade out (time is a blur). */
export const AUDIBLE_MAX_WARP = 10;

const ROOM_HUM: Record<SoundRoom, number> = {
  factory: 0.35,
  'mission-control': 0.18,
  'launch-pad': 0.12,
  station: 0.14,
  space: 0.05,
  surface: 0.04,
  quiet: 0,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The continuous mix for the current state. Pure. */
export function soundMix(i: SoundInputs): SoundMix {
  const hum = ROOM_HUM[i.room];
  if (i.paused || i.warp > AUDIBLE_MAX_WARP) {
    return { engine: 0, engineHz: 300, rumble: 0, wind: 0, windHz: 400, hum: hum * 0.6 };
  }
  const t = clamp01(i.thrust);
  // Through the structure only in vacuum: quieter and duller.
  const engine = t > 0 ? Math.pow(t, 0.7) * (i.vacuum ? 0.3 : 0.85) : 0;
  const engineHz = i.vacuum ? 260 + 240 * t : 420 + 1700 * t;
  const rumble = t > 0 ? t * (i.heavy ? 0.95 : 0.5) * (i.vacuum ? 0.5 : 1) : 0;
  // Wind grows with dynamic pressure (log scale), the plasma roar with heating.
  const q = clamp01(Math.log10(1 + Math.max(0, i.qPa)) / 4.7);
  const heat = clamp01(Math.max(0, i.heatWm2) / 2e6);
  const wind = clamp01(q * 0.55 + heat * 0.45);
  const windHz = 280 + Math.min(2400, Math.max(0, i.qPa) / 15 + heat * 900);
  return { engine, engineHz, rumble, wind, windHz, hum: t > 0 ? hum * 0.5 : hum };
}

/** One-shot sounds. */
export type SoundCue =
  'beep' | 'ignition' | 'touchdown' | 'crash' | 'dock' | 'chime' | 'shutter' | 'warning';

/** What the cue detector watches between ticks. */
export interface CueInputs {
  /** Launch countdown: seconds to go (null when not counting down). */
  readonly countdownS: number | null;
  /** A ship or booster is down: 'none' while flying or idle. */
  readonly landing: 'none' | 'landed' | 'crashed';
  readonly docked: boolean;
  /** Samples bagged on the current EVA, photos taken. */
  readonly bagged: number;
  readonly photos: number;
  /** A warning is showing (suit oxygen low, heat-shield failing...). */
  readonly warning: boolean;
}

export const NO_CUES: CueInputs = {
  countdownS: null,
  landing: 'none',
  docked: false,
  bagged: 0,
  photos: 0,
  warning: false,
};

/** Beeps on the last ten whole seconds of the count. */
export const BEEP_FROM_S = 10;

/** Cues for what changed since the last tick. Pure. */
export function soundCues(prev: CueInputs, next: CueInputs): SoundCue[] {
  const out: SoundCue[] = [];
  if (prev.countdownS !== null && next.countdownS !== null) {
    const a = Math.ceil(prev.countdownS);
    const b = Math.ceil(next.countdownS);
    if (b < a && b >= 1 && b <= BEEP_FROM_S) out.push('beep');
  }
  // Ignition: the count ran out (it stops counting at liftoff).
  if (prev.countdownS !== null && prev.countdownS <= 1.5 && next.countdownS === null)
    out.push('ignition');
  if (prev.landing === 'none' && next.landing !== 'none')
    out.push(next.landing === 'crashed' ? 'crash' : 'touchdown');
  if (!prev.docked && next.docked) out.push('dock');
  if (next.bagged > prev.bagged) out.push('chime');
  if (next.photos > prev.photos) out.push('shutter');
  if (!prev.warning && next.warning) out.push('warning');
  return out;
}

/** Clamps a stored volume (0..1, two decimals). */
export function sanitizeVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}
