import { AudioEngine } from '../audio/AudioEngine';
import {
  NO_CUES,
  SILENT_INPUTS,
  soundCues,
  soundMix,
  type CueInputs,
  type SoundInputs,
  type SoundRoom,
} from '../audio/soundMix';
import { localFrame } from '../flight/orbitMath';
import { airDensity } from '../simulation/constants';
import type { LocationId } from './locations';
import { flightRuntime } from './flightBinding';
import { launchRuntime } from './launchBinding';
import { useGameStore } from './gameStore';
import { usePhotoStore } from './photoStore';

/*
 * Connects the game to the procedural audio: 20 times a second it reads the runtimes and the
 * current location, mixes the continuous sounds and fires one-shot cues. Audio starts on the
 * first click or key press (browsers block it before that). `startAudio` returns the cleanup.
 */

const TICK_MS = 50;
/** Above this altitude the ascent is effectively in vacuum (sound only through the structure). */
const VACUUM_ALT_M = 80_000;

const ROOM: Record<LocationId, SoundRoom> = {
  factory: 'factory',
  'mission-control': 'mission-control',
  'launch-pad': 'launch-pad',
  flight: 'space',
  station: 'station',
  moon: 'space',
  mars: 'space',
};

/** What the listener hears from the launch at the pad. */
function launchInputs(room: SoundRoom): SoundInputs {
  const ls = launchRuntime.current;
  const a = launchRuntime.liveAscent;
  if (!a || (ls.phase !== 'ascent' && ls.phase !== 'recovery'))
    return { ...SILENT_INPUTS, room, paused: ls.paused, warp: ls.warp };
  return {
    room,
    thrust: a.enginesOn ? a.throttle : 0,
    heavy: a.stage === 'booster',
    vacuum: a.altitudeM > VACUUM_ALT_M,
    qPa: a.dynamicPressurePa,
    heatWm2: 0,
    paused: ls.paused,
    warp: ls.warp,
  };
}

/** What the listener hears from the ship (orbit, the Moon, Mars, the station). */
function flightInputs(room: SoundRoom): SoundInputs {
  const fs = flightRuntime.current;
  const s = flightRuntime.liveState;
  if (!s || fs.phase === 'idle') return { ...SILENT_INPUTS, room };
  const surface = fs.phase === 'surface' || !!fs.eva;
  const earth = !s.origin && s.ref !== 'moon';
  const altM = earth ? localFrame(s.r).altitudeM : Infinity;
  const marsAir = (fs.mars?.geometry?.radarM ?? Infinity) < 40_000;
  const speed = Math.hypot(s.v[0], s.v[1]);
  const qPa = earth && altM < VACUUM_ALT_M ? 0.5 * airDensity(altM) * speed * speed : 0;
  return {
    room: surface ? 'surface' : room,
    thrust: s.phase === 'flight' && s.propKg > 0 ? s.throttle : 0,
    heavy: false,
    vacuum: !(earth && altM < VACUUM_ALT_M) && !marsAir,
    qPa,
    heatWm2: s.heatFluxWm2,
    paused: fs.paused || fs.phase === 'debrief',
    warp: fs.warp,
  };
}

function cueInputs(): CueInputs {
  const ls = launchRuntime.current;
  const fs = flightRuntime.current;
  const s = flightRuntime.liveState;
  const eva = fs.eva;
  return {
    countdownS: ls.phase === 'countdown' && !ls.held ? Math.max(0, -ls.clockS) : null,
    landing:
      !s || s.phase === 'flight'
        ? 'none'
        : s.phase === 'landed' || s.phase === 'splashdown'
          ? 'landed'
          : 'crashed',
    docked: fs.proximity?.state.phase === 'docked',
    bagged: eva ? eva.samples.filter((x) => x.progress >= 1).length : 0,
    photos: usePhotoStore.getState().shots,
    warning: !!eva?.lowO2Warned,
  };
}

/** Starts the game's audio; returns a function that stops it and releases everything. */
export function startAudio(engine = new AudioEngine()): () => void {
  if (!engine.supported) return () => engine.dispose();
  const applyVolume = () => {
    const ui = useGameStore.getState().ui;
    engine.setVolume(ui.soundVolume, ui.soundMuted);
  };
  applyVolume();
  const offStore = useGameStore.subscribe((s, prev) => {
    if (s.ui.soundVolume !== prev.ui.soundVolume || s.ui.soundMuted !== prev.ui.soundMuted)
      applyVolume();
  });

  // Browsers allow audio only after a gesture.
  const unlock = () => {
    engine.unlock();
    applyVolume();
  };
  const onClick = (e: MouseEvent) => {
    const el = e.target as Element | null;
    if (el?.closest?.('button:not([disabled]), [role="tab"], input[type="checkbox"]'))
      engine.click();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('click', onClick, true);

  let prev = NO_CUES;
  const tick = () => {
    if (!engine.running) return;
    if (document.hidden) {
      engine.apply(soundMix(SILENT_INPUTS));
      return;
    }
    const location = useGameStore.getState().currentLocation;
    const room = ROOM[location];
    const inputs =
      location === 'launch-pad'
        ? launchInputs(room)
        : location === 'flight' ||
            location === 'moon' ||
            location === 'mars' ||
            location === 'station'
          ? flightInputs(room)
          : { ...SILENT_INPUTS, room };
    engine.apply(soundMix(inputs));
    const next = cueInputs();
    for (const cue of soundCues(prev, next)) engine.play(cue);
    prev = next;
  };
  const timer = window.setInterval(tick, TICK_MS);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('click', onClick, true);
    offStore();
    engine.dispose();
  };
}
