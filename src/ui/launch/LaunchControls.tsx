import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { launchRuntime } from '../../app/launchBinding';
import { formatTMinus } from '../../launch/countdown';
import { WARP_LEVELS, type LaunchSnapshot } from '../../launch/launchRuntime';
import type { PadCameraMode } from '../../scenes/launch-pad/launchPadController';
import { useShortcut } from '../useShortcut';

const CAMERAS: { id: PadCameraMode; label: string; key: string }[] = [
  { id: 'pad', label: 'Pad', key: '1' },
  { id: 'follow', label: 'Follow', key: '2' },
  { id: 'cinematic', label: 'Cinematic', key: '3' },
  { id: 'landing', label: 'Landing', key: '4' },
];

/** Phase-dependent launch controls, camera modes and the mission clock. */
export function LaunchControls({ snap }: { snap: LaunchSnapshot }) {
  const camera = useGameStore((s) => s.padCamera);
  const setCamera = useGameStore((s) => s.setPadCamera);
  const randomFailures = useGameStore((s) => s.ui.randomFailures);
  const setRandomFailures = useGameStore((s) => s.setRandomFailures);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const rt = launchRuntime;
  const { phase } = snap;
  const flying =
    phase === 'ascent' &&
    !!snap.ascent &&
    (snap.ascent.status === 'flying' || snap.ascent.status === 'coasting');

  useShortcut(['1'], () => setCamera('pad'));
  useShortcut(['2'], () => setCamera('follow'));
  useShortcut(['3'], () => setCamera('cinematic'));
  useShortcut(['4'], () => setCamera('landing'));
  const recovering = phase === 'recovery';
  useShortcut(
    [' '],
    () => {
      if (phase === 'countdown') {
        if (snap.held) rt.resume();
        else rt.hold();
      } else if (phase === 'ascent' || phase === 'recovery') rt.togglePause();
    },
    phase === 'countdown' || phase === 'ascent' || phase === 'recovery',
  );
  useShortcut(
    [']'],
    () => {
      const i = WARP_LEVELS.indexOf(snap.warp);
      rt.setWarp(WARP_LEVELS[Math.min(WARP_LEVELS.length - 1, i + 1)]!);
    },
    phase === 'ascent' || recovering,
  );
  useShortcut(
    ['['],
    () => {
      const i = WARP_LEVELS.indexOf(snap.warp);
      rt.setWarp(WARP_LEVELS[Math.max(0, i - 1)]!);
    },
    phase === 'ascent' || recovering,
  );

  const clock =
    phase === 'countdown'
      ? formatTMinus(snap.clockS)
      : recovering && snap.recovery
        ? formatTMinus(snap.recovery.state.tS)
        : phase === 'ascent' || ((phase === 'debrief' || phase === 'handoff') && snap.ascent)
          ? formatTMinus(snap.ascent?.tS ?? 0)
          : phase === 'rollout'
            ? `Rollout ${Math.round(snap.rolloutProgress * 100)}%`
            : 'T-40:00';

  return (
    <div className="camera-toolbar launch-controls">
      <div
        className={`mission-clock ${snap.held || snap.paused ? 'held' : ''}`}
        role="timer"
        aria-live="off"
      >
        {clock}
        {snap.held && <span className="clock-tag">HOLD</span>}
        {snap.paused && <span className="clock-tag">PAUSED</span>}
        {(phase === 'ascent' || recovering) && snap.warp > 1 && (
          <span className="clock-tag">{snap.warp}×</span>
        )}
        {recovering && <span className="clock-tag">BOOSTER</span>}
      </div>
      <div className="toolbar">
        {phase === 'rollout' && (
          <button type="button" onClick={() => rt.skipRollout()}>
            Skip rollout
          </button>
        )}
        {phase === 'pad' && (
          <>
            <button type="button" className="primary" onClick={() => rt.startCountdown()}>
              Start countdown
            </button>
            <label
              className="inline-check"
              title="Mission risk can cause engine-outs or vehicle loss"
            >
              <input
                type="checkbox"
                checked={randomFailures}
                onChange={(e) => setRandomFailures(e.target.checked)}
              />
              Random failures
            </label>
          </>
        )}
        {phase === 'countdown' && (
          <>
            <button type="button" onClick={() => (snap.held ? rt.resume() : rt.hold())}>
              {snap.held ? 'Resume count' : 'Hold'} <kbd>Space</kbd>
            </button>
            <button
              type="button"
              onClick={() => rt.skipToTerminalCount()}
              disabled={snap.clockS >= -10}
              title={snap.clockS >= -10 ? 'Already in the terminal count.' : undefined}
            >
              Skip to T-10 s
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => rt.abort('Scrubbed by the launch director.')}
            >
              Scrub
            </button>
          </>
        )}
        {recovering && (
          <>
            <button type="button" onClick={() => rt.togglePause()}>
              {snap.paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
            </button>
            <span className="warp" role="group" aria-label="Time warp">
              {WARP_LEVELS.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={snap.warp === w}
                  disabled={!!snap.recovery?.manualActive && w > 1}
                  title={
                    snap.recovery?.manualActive && w > 1
                      ? 'Manual landings fly in real time.'
                      : undefined
                  }
                  onClick={() => rt.setWarp(w)}
                >
                  {w}×
                </button>
              ))}
            </span>
          </>
        )}
        {phase === 'ascent' && (
          <>
            <button
              type="button"
              onClick={() => rt.togglePause()}
              disabled={!flying}
              title={flying ? undefined : 'The flight has ended.'}
            >
              {snap.paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
            </button>
            <span className="warp" role="group" aria-label="Time warp">
              {WARP_LEVELS.map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={snap.warp === w}
                  onClick={() => rt.setWarp(w)}
                >
                  {w}×
                </button>
              ))}
            </span>
            {confirmAbort ? (
              <>
                <button
                  type="button"
                  className="danger"
                  autoFocus
                  onClick={() => {
                    rt.abort();
                    setConfirmAbort(false);
                  }}
                >
                  Confirm ABORT
                </button>
                <button type="button" onClick={() => setConfirmAbort(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger"
                onClick={() => setConfirmAbort(true)}
                disabled={!flying}
                title={flying ? 'Abort the flight' : 'The flight has ended.'}
              >
                ABORT
              </button>
            )}
          </>
        )}
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
      </div>
    </div>
  );
}
