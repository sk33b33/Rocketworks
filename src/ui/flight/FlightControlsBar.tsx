import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import { formatTMinus } from '../../launch/countdown';
import { FLIGHT_WARP_LEVELS, type FlightSnapshot } from '../../flight/flightRuntime';
import type { FlightCameraMode } from '../../scenes/flight/flightController';
import { formatPercent } from '../format';
import { useShortcut } from '../useShortcut';

const CAMERAS: { id: FlightCameraMode; label: string; key: string }[] = [
  { id: 'chase', label: 'Chase', key: '1' },
  { id: 'orbit', label: 'Orbit', key: '2' },
  { id: 'map', label: 'Map', key: 'M' },
];

export interface CameraSet<T extends string> {
  readonly options: readonly { id: T; label: string; key: string }[];
  readonly current: T;
  readonly set: (id: T) => void;
}

/** Mission clock, pause, time warp, throttle shortcuts, cameras and help. */
export function FlightControlsBar<T extends string = FlightCameraMode>({
  snap,
  onHelp,
  cameras,
}: {
  snap: FlightSnapshot;
  onHelp: () => void;
  /** Camera choices (defaults to the Flight scene's). */
  cameras?: CameraSet<T>;
}) {
  const flightCamera = useGameStore((s) => s.flightCamera);
  const setFlightCamera = useGameStore((s) => s.setFlightCamera);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const rt = flightRuntime;
  const s = snap.state;
  const onSurface = snap.phase === 'surface';
  const flying = snap.phase === 'flight' && s?.phase === 'flight';
  const timeRuns = flying || onSurface;
  // Deep-space warp levels only matter on Moon missions.
  const levels = FLIGHT_WARP_LEVELS.filter((w) => w <= 1000 || !!snap.lunar);
  const idx = levels.indexOf(snap.warp as (typeof levels)[number]);
  const cams = (cameras ?? {
    options: CAMERAS,
    current: flightCamera,
    set: setFlightCamera,
  }) as unknown as CameraSet<string>;

  useShortcut(['1'], () => cams.set(cams.options[0]!.id));
  useShortcut(['2'], () => cams.options[1] && cams.set(cams.options[1].id));
  useShortcut(
    ['3'],
    () => cams.options[2] && cams.options[2].key === '3' && cams.set(cams.options[2].id),
  );
  useShortcut(
    ['m', 'M'],
    () => !cameras && setFlightCamera(flightCamera === 'map' ? 'chase' : 'map'),
  );
  useShortcut([' '], () => rt.togglePause(), timeRuns);
  useShortcut(
    ['.', ']'],
    () => rt.setWarp(levels[Math.min(levels.length - 1, idx + 1)]!),
    timeRuns,
  );
  useShortcut([',', '['], () => rt.setWarp(levels[Math.max(0, idx - 1)]!), timeRuns);
  useShortcut(['z', 'Z'], () => rt.setThrottle(1), flying);
  useShortcut(['x', 'X'], () => rt.cutoff(), flying);

  return (
    <div className="camera-toolbar launch-controls">
      <div className={`mission-clock ${snap.paused ? 'held' : ''}`} role="timer" aria-live="off">
        {formatTMinus(s?.tS ?? 0)}
        {snap.paused && <span className="clock-tag">PAUSED</span>}
        {snap.warp > 1 && <span className="clock-tag">{snap.warp}×</span>}
        {s && s.throttle > 0 && <span className="clock-tag">THR {formatPercent(s.throttle)}</span>}
      </div>
      <div className="toolbar">
        <button
          type="button"
          onClick={() => rt.togglePause()}
          disabled={!timeRuns}
          title={timeRuns ? undefined : 'The flight has ended.'}
        >
          {snap.paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
        </button>
        <span className="warp" role="group" aria-label="Time warp">
          {levels.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={snap.warp === w}
              disabled={!timeRuns || w > snap.maxWarp}
              title={w > snap.maxWarp ? (snap.warpLimitReason ?? undefined) : undefined}
              onClick={() => rt.setWarp(w)}
            >
              {w}×
            </button>
          ))}
        </span>
        <button
          type="button"
          onClick={() => rt.cutoff()}
          disabled={!flying || !s || s.throttle === 0}
          title="Cut the engines and take manual control"
        >
          Cutoff <kbd>X</kbd>
        </button>
        <button
          type="button"
          disabled
          title="Not available: the booster was left behind at staging; the ship has no further stages."
        >
          Stage
        </button>
        <span className="warp" role="group" aria-label="Camera">
          {cams.options.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={cams.current === c.id}
              onClick={() => cams.set(c.id)}
            >
              {c.label} <kbd>{c.key}</kbd>
            </button>
          ))}
        </span>
        <button type="button" onClick={() => requestCamera('reset')}>
          Reset view
        </button>
        <button type="button" onClick={onHelp}>
          Controls <kbd>?</kbd>
        </button>
        {confirmEnd ? (
          <>
            <button
              type="button"
              className="danger"
              autoFocus
              onClick={() => {
                rt.endFlight();
                setConfirmEnd(false);
              }}
            >
              Confirm: end flight
            </button>
            <button type="button" onClick={() => setConfirmEnd(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="danger"
            disabled={!timeRuns}
            onClick={() => setConfirmEnd(true)}
            title={
              timeRuns
                ? 'End the flight here; a ship left in space or on the Moon is not recovered.'
                : 'The flight has ended.'
            }
          >
            End flight
          </button>
        )}
      </div>
    </div>
  );
}
