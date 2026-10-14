import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import { FLIGHT_WARP_LEVELS } from '../../flight/flightRuntime';
import { formatTMinus } from '../../launch/countdown';
import type { StationCameraMode } from '../../scenes/station/stationController';
import { useFlightSnapshot } from '../flight/useFlight';
import { useShortcut } from '../useShortcut';
import { ApproachPanel } from './ApproachPanel';
import { DockingReticle } from './DockingReticle';
import { ProximityControls } from './ProximityControls';
import { useStationKeys } from './useStationKeys';

const CAMERAS: { id: StationCameraMode; label: string; key: string }[] = [
  { id: 'chase', label: 'Chase', key: '1' },
  { id: 'docking', label: 'Docking', key: '2' },
  { id: 'orbit', label: 'Station', key: '3' },
];

function StationHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="panel help debrief" role="dialog" aria-label="Station controls">
      <div className="panel-header">
        <h2>Proximity controls</h2>
        <button type="button" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
      <dl className="facts">
        <dt>W / S</dt>
        <dd>Translate toward / away from the port</dd>
        <dt>A / D · R / F</dt>
        <dd>Translate left / right · up / down</dd>
        <dt>Arrows · Q / E</dt>
        <dd>Pitch and yaw · roll</dd>
        <dt>T · Y</dt>
        <dd>Attitude hold · align nose to the port</dd>
        <dt>G · B</dt>
        <dd>Docking assist · abort (back out)</dd>
        <dt>1 / 2 / 3</dt>
        <dd>Chase / docking / station camera</dd>
        <dt>Space · . / ,</dt>
        <dd>Pause · time warp (10× in free flight, 1000× while docked)</dd>
      </dl>
      <p className="small-text muted">
        Inside the 200 m keep-out sphere stay in the corridor and close slower than 0.1 m/s plus 1%
        of the range. Contact at 0.02–0.35 m/s, within 0.3 m and 4° to latch. Near the station the
        ship drifts as orbital mechanics dictate: thrust to correct it.
      </p>
    </div>
  );
}

/** Orbital Station overlay: approach data, controls, tasks, docking camera and debrief hand-off. */
export function StationHud() {
  const snap = useFlightSnapshot();
  const goTo = useGameStore((s) => s.goTo);
  const camera = useGameStore((s) => s.stationCamera);
  const setCamera = useGameStore((s) => s.setStationCamera);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const [help, setHelp] = useState(false);
  const view = snap.proximity;
  const active = snap.phase === 'proximity' && !!view;
  const free = active && view?.state.phase === 'free';
  useStationKeys(free && !help);
  useShortcut(['1'], () => setCamera('chase'));
  useShortcut(['2'], () => setCamera('docking'));
  useShortcut(['3'], () => setCamera('orbit'));
  useShortcut(['?'], () => setHelp((h) => !h));
  useShortcut(['Escape'], () => setHelp(false), help);
  useShortcut([' '], () => flightRuntime.togglePause(), active);
  useShortcut(
    ['g', 'G'],
    () => flightRuntime.setProxAssist(view?.assist === 'dock' ? 'off' : 'dock'),
    free,
  );
  useShortcut(
    ['b', 'B'],
    () => flightRuntime.setProxAssist(view?.assist === 'abort' ? 'off' : 'abort'),
    free,
  );
  useShortcut(['t', 'T'], () => flightRuntime.setProxHold(!view?.hold), free);
  useShortcut(['y', 'Y'], () => flightRuntime.setProxAlign(!view?.align), free);
  const idx = FLIGHT_WARP_LEVELS.indexOf(snap.warp);
  useShortcut(
    ['.', ']'],
    () =>
      flightRuntime.setWarp(FLIGHT_WARP_LEVELS[Math.min(FLIGHT_WARP_LEVELS.length - 1, idx + 1)]!),
    active,
  );
  useShortcut(
    [',', '['],
    () => flightRuntime.setWarp(FLIGHT_WARP_LEVELS[Math.max(0, idx - 1)]!),
    active,
  );

  if (!active || !view) {
    const flying = snap.phase === 'flight';
    return (
      <div className="factory-hud launch-hud">
        <div className="panel empty-pad" role="status">
          <h2>No ship at the station</h2>
          <p>
            {flying
              ? 'Your ship is in orbital flight. Engage "Rendezvous with station", then begin proximity operations from the Flight / Orbit HUD.'
              : 'Fly a Station Crew Rotation mission: launch, rendezvous with the station, then begin proximity operations here.'}
          </p>
          <div className="actions">
            {flying ? (
              <button type="button" className="primary" onClick={() => goTo('flight')}>
                Go to Flight / Orbit
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => goTo('mission-control')}>
                Go to Mission Control
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="factory-hud launch-hud station-hud">
      <div className="hud-col hud-left">
        <section data-panel="approach">
          <ApproachPanel view={view} />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="controls">
          <ProximityControls view={view} />
        </section>
      </div>
      {camera === 'docking' && view.state.phase === 'free' && <DockingReticle view={view} />}
      {snap.message && (
        <div className="flight-message" role="status" aria-live="polite">
          {[...view.state.events].reverse()[0]?.text ?? snap.message}
        </div>
      )}
      {help && <StationHelp onClose={() => setHelp(false)} />}
      <div className="camera-toolbar launch-controls">
        <div className={`mission-clock ${snap.paused ? 'held' : ''}`} role="timer" aria-live="off">
          {formatTMinus(view.state.tS)}
          {snap.paused && <span className="clock-tag">PAUSED</span>}
          {snap.warp > 1 && <span className="clock-tag">{snap.warp}×</span>}
        </div>
        <div className="toolbar">
          <button type="button" onClick={() => flightRuntime.togglePause()}>
            {snap.paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>
          </button>
          <span className="warp" role="group" aria-label="Time warp">
            {FLIGHT_WARP_LEVELS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={snap.warp === w}
                disabled={w > snap.maxWarp}
                title={w > snap.maxWarp ? (snap.warpLimitReason ?? undefined) : undefined}
                onClick={() => flightRuntime.setWarp(w)}
              >
                {w}×
              </button>
            ))}
          </span>
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
          <button type="button" onClick={() => setHelp(true)}>
            Controls <kbd>?</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
