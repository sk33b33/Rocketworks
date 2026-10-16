import { useSyncExternalStore } from 'react';
import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import { REPLAY_SPEEDS, type ReplayView } from '../../flight/flightTrack';
import { localFrame } from '../../flight/orbitMath';
import type { FlightCameraMode } from '../../scenes/flight/flightController';
import { useShortcut } from '../useShortcut';
import { usePhotoStore } from '../../app/photoStore';
import { fmt, formatDuration } from './useFlight';

const CAMERAS: { id: FlightCameraMode; label: string }[] = [
  { id: 'chase', label: 'Chase' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'map', label: 'Map' },
];

/** The flight replay's playback state (null when not replaying). */
export function useReplay(): ReplayView | null {
  const r = flightRuntime.replay;
  return useSyncExternalStore(r.subscribe, r.getSnapshot);
}

/** "Watch replay" for the debrief: switches to the Flight view and plays the recorded flight. */
export function ReplayButton() {
  const goTo = useGameStore((s) => s.goTo);
  const check = flightRuntime.replayAvailability();
  return (
    <button
      type="button"
      disabled={!check.ok}
      title={check.ok ? 'Watch the flight again from orbit insertion to the end' : check.reason}
      onClick={() => {
        if (flightRuntime.startReplay().ok) goTo('flight');
      }}
    >
      Watch replay
    </button>
  );
}

/** Replay controls: play/pause, speed, seek, cameras, and back to the debrief. */
export function ReplayBar({ view }: { view: ReplayView }) {
  const rp = flightRuntime.replay;
  const camera = useGameStore((s) => s.flightCamera);
  const setCamera = useGameStore((s) => s.setFlightCamera);
  const s = flightRuntime.liveState;
  const altKm = s && !s.origin && s.ref !== 'moon' ? localFrame(s.r).altitudeM / 1000 : null;
  useShortcut([' '], () => rp.togglePlay());
  const photo = usePhotoStore((p) => p.active);
  useShortcut(['Escape'], () => rp.stop(), !photo);
  useShortcut(['1'], () => setCamera('chase'));
  useShortcut(['2'], () => setCamera('orbit'));
  useShortcut(['m', 'M'], () => setCamera(camera === 'map' ? 'chase' : 'map'));
  const step = Math.max(0.1, view.duration / 500);
  return (
    <div className="panel replay-bar" role="toolbar" aria-label="Flight replay">
      <span className="photo-title">REPLAY</span>
      <button type="button" className="primary" onClick={() => rp.togglePlay()}>
        {view.playing ? 'Pause' : view.t >= view.duration ? 'Play again' : 'Play'}
      </button>
      <div className="replay-group" role="group" aria-label="Replay speed">
        {REPLAY_SPEEDS.map((sp) => (
          <button
            key={sp}
            type="button"
            aria-pressed={view.speed === sp}
            onClick={() => rp.setSpeed(sp)}
          >
            {sp}×
          </button>
        ))}
      </div>
      <input
        type="range"
        className="replay-seek"
        aria-label="Replay position"
        min={0}
        max={view.duration}
        step={step}
        value={view.t}
        onChange={(e) => rp.seek(Number(e.target.value))}
      />
      <span className="replay-clock" aria-live="off">
        T+{formatDuration(view.missionTimeS)}
        {altKm !== null && ` · ${fmt(altKm, 1)} km`}
      </span>
      <div className="replay-group" role="group" aria-label="Camera">
        {CAMERAS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={camera === c.id}
            onClick={() => setCamera(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => rp.stop()}>
        Back to debrief
      </button>
    </div>
  );
}
