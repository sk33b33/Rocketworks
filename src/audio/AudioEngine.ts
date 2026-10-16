import type { SoundCue, SoundMix } from './soundMix';

/*
 * Procedural sound with the Web Audio API: no recorded assets. A looped noise buffer feeds the
 * engine roar, the booster rumble and the wind through filters; two sines make the room hum; the
 * one-shot cues are short synthesized envelopes. Browsers only allow audio after a user gesture,
 * so the context is created by `unlock()`. Without Web Audio (tests, old browsers) everything is
 * a silent no-op.
 */

/** How quickly continuous sounds follow the mix (time constant, s). */
const SMOOTH_S = 0.12;

type Ctor = typeof AudioContext;

interface Voices {
  readonly master: GainNode;
  readonly engineGain: GainNode;
  readonly engineFilter: BiquadFilterNode;
  readonly rumbleGain: GainNode;
  readonly windGain: GainNode;
  readonly windFilter: BiquadFilterNode;
  readonly humGain: GainNode;
  readonly sources: AudioScheduledSourceNode[];
  readonly noise: AudioBuffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private v: Voices | null = null;
  private volume = 0.6;
  private muted = false;
  private disposed = false;

  constructor(private readonly ctor: Ctor | null = audioContextCtor()) {}

  /** Whether audio can play at all here. */
  get supported(): boolean {
    return !!this.ctor;
  }
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Creates (or resumes) the audio context; call from a user gesture. */
  unlock(): void {
    if (this.disposed || !this.ctor) return;
    if (!this.ctx) {
      try {
        this.ctx = new this.ctor();
        this.v = buildVoices(this.ctx);
        this.applyVolume();
      } catch {
        this.ctx = null;
        this.v = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    const { ctx, v } = this;
    if (!ctx || !v) return;
    // A perceptual curve: half the slider is about a quarter of the power.
    const g = this.muted ? 0 : this.volume * this.volume;
    v.master.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
  }

  /** Moves the continuous sounds toward a mix. */
  apply(mix: SoundMix): void {
    const { ctx, v } = this;
    if (!ctx || !v || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    v.engineGain.gain.setTargetAtTime(mix.engine * 0.55, t, SMOOTH_S);
    v.engineFilter.frequency.setTargetAtTime(mix.engineHz, t, SMOOTH_S);
    v.rumbleGain.gain.setTargetAtTime(mix.rumble * 0.9, t, SMOOTH_S);
    v.windGain.gain.setTargetAtTime(mix.wind * 0.4, t, SMOOTH_S * 2);
    v.windFilter.frequency.setTargetAtTime(mix.windHz, t, SMOOTH_S * 2);
    v.humGain.gain.setTargetAtTime(mix.hum * 0.05, t, 0.5);
  }

  /** Plays a one-shot cue. */
  play(cue: SoundCue): void {
    const { ctx, v } = this;
    if (!ctx || !v || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (cue) {
      case 'beep':
        return tone(ctx, v.master, 880, t, 0.12, 0.22, 'sine');
      case 'ignition':
        tone(ctx, v.master, 440, t, 0.5, 0.25, 'sine');
        return noiseBurst(ctx, v, t, 1.2, 0.35, 'lowpass', 600);
      case 'touchdown':
        sweep(ctx, v.master, 90, 38, t, 0.4, 0.6);
        return noiseBurst(ctx, v, t, 0.35, 0.3, 'lowpass', 400);
      case 'crash':
        sweep(ctx, v.master, 70, 25, t, 0.9, 0.7);
        return noiseBurst(ctx, v, t, 1.6, 0.6, 'lowpass', 1200);
      case 'dock':
        tone(ctx, v.master, 140, t, 0.09, 0.3, 'square');
        return noiseBurst(ctx, v, t + 0.02, 0.12, 0.25, 'bandpass', 900);
      case 'chime':
        tone(ctx, v.master, 660, t, 0.18, 0.18, 'sine');
        return tone(ctx, v.master, 990, t + 0.12, 0.3, 0.16, 'sine');
      case 'shutter':
        noiseBurst(ctx, v, t, 0.04, 0.3, 'highpass', 3000);
        return noiseBurst(ctx, v, t + 0.07, 0.05, 0.25, 'highpass', 2500);
      case 'warning':
        tone(ctx, v.master, 620, t, 0.15, 0.16, 'triangle');
        return tone(ctx, v.master, 520, t + 0.2, 0.15, 0.16, 'triangle');
    }
  }

  /** A soft interface click. */
  click(): void {
    const { ctx, v } = this;
    if (!ctx || !v || ctx.state !== 'running') return;
    tone(ctx, v.master, 1800, ctx.currentTime, 0.025, 0.05, 'triangle');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.v?.sources ?? []) {
      try {
        s.stop();
      } catch {
        // Already stopped.
      }
      s.disconnect();
    }
    this.v?.master.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.v = null;
  }
}

function audioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function buildVoices(ctx: AudioContext): Voices {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Two seconds of white noise, looped by every noise voice.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const loop = () => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    return src;
  };

  const engineSrc = loop();
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 400;
  engineFilter.Q.value = 0.7;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineSrc.connect(engineFilter).connect(engineGain).connect(master);

  const rumbleSrc = loop();
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 90;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0;
  rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(master);

  const windSrc = loop();
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 400;
  windFilter.Q.value = 0.8;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windFilter).connect(windGain).connect(master);

  const humGain = ctx.createGain();
  humGain.gain.value = 0;
  humGain.connect(master);
  const humA = ctx.createOscillator();
  humA.frequency.value = 60;
  const humB = ctx.createOscillator();
  humB.frequency.value = 120.4;
  const humBGain = ctx.createGain();
  humBGain.gain.value = 0.4;
  humA.connect(humGain);
  humB.connect(humBGain).connect(humGain);

  const sources: AudioScheduledSourceNode[] = [engineSrc, rumbleSrc, windSrc, humA, humB];
  for (const s of sources) s.start();
  return {
    master,
    engineGain,
    engineFilter,
    rumbleGain,
    windGain,
    windFilter,
    humGain,
    sources,
    noise,
  };
}

/** A short enveloped tone. The nodes free themselves when they stop. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  hz: number,
  at: number,
  dur: number,
  level: number,
  type: OscillatorType,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  osc.onended = () => g.disconnect();
}

/** A falling tone (impacts). */
function sweep(
  ctx: AudioContext,
  out: AudioNode,
  fromHz: number,
  toHz: number,
  at: number,
  dur: number,
  level: number,
): void {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(fromHz, at);
  osc.frequency.exponentialRampToValueAtTime(toHz, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  osc.onended = () => g.disconnect();
}

/** A filtered burst of the shared noise. */
function noiseBurst(
  ctx: AudioContext,
  v: Voices,
  at: number,
  dur: number,
  level: number,
  type: BiquadFilterType,
  hz: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(v.master);
  src.start(at, Math.random());
  src.stop(at + dur + 0.05);
  src.onended = () => g.disconnect();
}
