import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/AudioEngine';
import {
  AUDIBLE_MAX_WARP,
  NO_CUES,
  sanitizeVolume,
  SILENT_INPUTS,
  soundCues,
  soundMix,
  type CueInputs,
} from '../src/audio/soundMix';

describe('sound mix', () => {
  it('is silent with nothing going on, with a hum in the factory', () => {
    expect(soundMix(SILENT_INPUTS)).toMatchObject({ engine: 0, rumble: 0, wind: 0, hum: 0 });
    expect(soundMix({ ...SILENT_INPUTS, room: 'factory' }).hum).toBeGreaterThan(0);
  });

  it('roars louder and brighter with thrust, deeper on the booster, muffled in vacuum', () => {
    const low = soundMix({ ...SILENT_INPUTS, room: 'launch-pad', thrust: 0.3 });
    const full = soundMix({ ...SILENT_INPUTS, room: 'launch-pad', thrust: 1 });
    expect(full.engine).toBeGreaterThan(low.engine);
    expect(full.engineHz).toBeGreaterThan(low.engineHz);
    const booster = soundMix({ ...SILENT_INPUTS, thrust: 1, heavy: true });
    expect(booster.rumble).toBeGreaterThan(full.rumble);
    const vac = soundMix({ ...SILENT_INPUTS, thrust: 1, vacuum: true });
    expect(vac.engine).toBeLessThan(full.engine);
    expect(vac.engineHz).toBeLessThan(full.engineHz);
    // The engine drowns out part of the room tone.
    expect(full.hum).toBeLessThan(soundMix({ ...SILENT_INPUTS, room: 'launch-pad' }).hum);
  });

  it('blows harder with dynamic pressure and re-entry heating', () => {
    const calm = soundMix({ ...SILENT_INPUTS, qPa: 100 });
    const maxQ = soundMix({ ...SILENT_INPUTS, qPa: 30_000 });
    const plasma = soundMix({ ...SILENT_INPUTS, qPa: 30_000, heatWm2: 1.5e6 });
    expect(maxQ.wind).toBeGreaterThan(calm.wind);
    expect(plasma.wind).toBeGreaterThan(maxQ.wind);
    expect(plasma.wind).toBeLessThanOrEqual(1);
    expect(maxQ.windHz).toBeGreaterThan(calm.windHz);
  });

  it('goes quiet while paused or at high warp', () => {
    const loud = { ...SILENT_INPUTS, room: 'space' as const, thrust: 1, qPa: 20_000 };
    for (const m of [
      soundMix({ ...loud, paused: true }),
      soundMix({ ...loud, warp: AUDIBLE_MAX_WARP * 10 }),
    ]) {
      expect(m.engine).toBe(0);
      expect(m.wind).toBe(0);
    }
    expect(soundMix({ ...loud, warp: AUDIBLE_MAX_WARP }).engine).toBeGreaterThan(0);
  });
});

describe('sound cues', () => {
  const at = (patch: Partial<CueInputs>): CueInputs => ({ ...NO_CUES, ...patch });

  it('beeps once per second over the last ten, then ignites', () => {
    expect(soundCues(at({ countdownS: 10.2 }), at({ countdownS: 9.9 }))).toEqual(['beep']);
    expect(soundCues(at({ countdownS: 9.9 }), at({ countdownS: 9.6 }))).toEqual([]);
    expect(soundCues(at({ countdownS: 30.2 }), at({ countdownS: 29.8 }))).toEqual([]);
    expect(soundCues(at({ countdownS: 0.4 }), at({ countdownS: null }))).toEqual(['ignition']);
    // A scrub (count stopped early) doesn't ignite.
    expect(soundCues(at({ countdownS: 40 }), at({ countdownS: null }))).toEqual([]);
  });

  it('marks touchdowns, crashes, docking, samples, photos and warnings once', () => {
    expect(soundCues(NO_CUES, at({ landing: 'landed' }))).toEqual(['touchdown']);
    expect(soundCues(NO_CUES, at({ landing: 'crashed' }))).toEqual(['crash']);
    expect(soundCues(at({ landing: 'landed' }), at({ landing: 'landed' }))).toEqual([]);
    expect(soundCues(NO_CUES, at({ docked: true }))).toEqual(['dock']);
    expect(soundCues(at({ bagged: 1 }), at({ bagged: 2 }))).toEqual(['chime']);
    expect(soundCues(at({ photos: 3 }), at({ photos: 4 }))).toEqual(['shutter']);
    expect(soundCues(NO_CUES, at({ warning: true }))).toEqual(['warning']);
    expect(soundCues(at({ warning: true }), at({ warning: true }))).toEqual([]);
  });

  it('keeps stored volumes in range', () => {
    expect(sanitizeVolume(0.456, 0.6)).toBe(0.46);
    expect(sanitizeVolume(3, 0.6)).toBe(1);
    expect(sanitizeVolume(-1, 0.6)).toBe(0);
    expect(sanitizeVolume('loud', 0.6)).toBe(0.6);
  });
});

describe('audio engine', () => {
  it('is a silent no-op without Web Audio', () => {
    const engine = new AudioEngine(null);
    expect(engine.supported).toBe(false);
    engine.unlock();
    engine.setVolume(1, false);
    engine.apply(soundMix({ ...SILENT_INPUTS, thrust: 1 }));
    engine.play('beep');
    engine.click();
    expect(engine.running).toBe(false);
    engine.dispose();
    engine.dispose();
  });
});

describe('sound settings in saves', () => {
  it('default for old saves and clamp damaged values', async () => {
    const { parseSave, serializeSave, DEFAULT_UI } = await import('../src/persistence/saveGame');
    expect(DEFAULT_UI).toMatchObject({ soundVolume: 0.6, soundMuted: false });
    const { createStarterBlueprint } = await import('../src/rocket/catalog/blueprints');
    const bp = createStarterBlueprint('2026-01-01T00:00:00.000Z');
    const raw = JSON.parse(
      serializeSave({
        blueprints: [bp],
        activeBlueprintId: bp.id,
        ui: { ...DEFAULT_UI, soundVolume: 0.2, soundMuted: true },
      } as never),
    );
    const ok = parseSave(JSON.stringify(raw));
    if (ok.status !== 'loaded') throw new Error(ok.status);
    expect(ok.data.ui).toMatchObject({ soundVolume: 0.2, soundMuted: true });
    const old = parseSave(
      JSON.stringify({ ...raw, ui: { ...raw.ui, soundVolume: 'max', soundMuted: 'yes' } }),
    );
    if (old.status !== 'loaded') throw new Error(old.status);
    expect(old.data.ui).toMatchObject({ soundVolume: 0.6, soundMuted: false });
  });
});
