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

/** Mission clock, pause, time warp, throttle shortcuts, cameras and help. */
export function FlightControlsBar({ snap, onHelp }: { snap: FlightSnapshot; onHelp: () => void }) {
  const camera = useGameStore((s) => s.flightCamera);
  const setCamera = useGameStore((s) => s.setFlightCamera);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const rt = flightRuntime;
  const s = snap.state;
  const flying = snap.phase === 'flight' && s?.phase === 'flight';
  const idx = FLIGHT_WARP_LEVELS.indexOf(snap.warp);

  useShortcut(['1'], () => setCamera('chase'));
  useShortcut(['2'], () => setCamera('orbit'));
  useShortcut(['m', 'M'], () => setCamera(camera === 'map' ? 'chase' : 'map'));
  useShortcut([' '], () => rt.togglePause(), flying);
  useShortcut(
    ['.', ']'],
    () => rt.setWarp(FLIGHT_WARP_LEVELS[Math.min(FLIGHT_WARP_LEVELS.length - 1, idx + 1)]!),
    flying,
  );
  useShortcut([',', '['], () => rt.setWarp(FLIGHT_WARP_LEVELS[Math.max(0, idx - 1)]!), flying);
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
          disabled={!flying}
          title={flying ? undefined : 'The flight has ended.'}
        >
          {snap.paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
        </button>
        <span className="warp" role="group" aria-label="Time warp">
          {FLIGHT_WARP_LEVELS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={snap.warp === w}
              disabled={!flying || w > snap.maxWarp}
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
          {CAMERAS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={camera === c.id}
              onClick={() => setCamera(c.id)}
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
            disabled={!flying}
            onClick={() => setConfirmEnd(true)}
            title={
              flying
                ? 'End the flight here; a ship left in space is not recovered.'
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
