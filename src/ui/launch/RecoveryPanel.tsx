import { useEffect } from 'react';
import { launchRuntime } from '../../app/launchBinding';
import type { BoosterKey, RecoverySessionView } from '../../recovery/recoverySession';
import type { LaunchSnapshot } from '../../launch/launchRuntime';
import { CATCH_WINDOW, BOOSTER_TOUCHDOWN, PLATFORM_HALF_DECK_M } from '../../recovery/recoveryPlan';
import { formatPercent } from '../format';
import type { BoosterRecoverySummary } from '../../launch/flightRecord';

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const KEYS: Record<string, BoosterKey> = {
  Shift: 'throttle-up',
  Control: 'throttle-down',
  d: 'tilt-downrange',
  a: 'tilt-uprange',
};

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}

/** Held keys for a manual booster landing (only while the player is flying it). */
function useBoosterKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const keyOf = (e: KeyboardEvent) => KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = keyOf(e);
      if (!k) return;
      e.preventDefault();
      launchRuntime.setBoosterKey(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = keyOf(e);
      if (k) launchRuntime.setBoosterKey(k, false);
    };
    const blur = () => Object.values(KEYS).forEach((k) => launchRuntime.setBoosterKey(k, false));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      blur();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled]);
}

export function RecoveryResultLine({ r }: { r: BoosterRecoverySummary }) {
  const good = r.outcome === 'caught' || r.outcome === 'landed';
  return (
    <p className={good ? 'tone-ok' : r.outcome === 'expended' ? 'muted' : 'tone-bad'}>
      {good ? '✓' : r.outcome === 'expended' ? '–' : '✕'} Booster: {r.summary}
      {r.grade && (
        <>
          {' '}
          Rating <strong className={`grade-${r.grade}`}>{r.grade}</strong>
          {r.manual ? ' (flown manually)' : ''}.
        </>
      )}
      {r.simulated ? ' (replay skipped; result simulated)' : ''}
    </p>
  );
}

/** Booster recovery replay: status, telemetry, manual landing and skip. */
export function RecoveryPanel({ snap }: { snap: LaunchSnapshot }) {
  const v: RecoverySessionView | null = snap.recovery;
  const manualActive = !!v?.manualActive;
  useBoosterKeys(manualActive);
  if (!v) return null;
  const s = v.state;
  const flying = s.phase === 'flight';
  const spec = snap.context?.boosterSpec;
  const reserve = spec ? s.propKg / Math.max(1, spec.stage.propellantKg) : 0;
  const toGo = v.target.x - s.x;
  const canManual = launchRuntime.manualLandingAvailable || v.manualRequested;
  const limits =
    v.target.mode === 'catch'
      ? CATCH_WINDOW
      : { ...BOOSTER_TOUCHDOWN, missM: PLATFORM_HALF_DECK_M };
  return (
    <div className="panel telemetry recovery-panel">
      <div className="panel-header">
        <h2>Booster recovery</h2>
        <span className="muted">replay from staging</span>
      </div>
      <div className="eyebrow">
        {v.target.mode === 'catch'
          ? 'Tower catch'
          : `Ocean platform, ${fmt(v.target.x / 1000, 1)} km downrange`}
      </div>
      <p className="hint">
        {flying
          ? v.phaseLabel
          : s.phase === 'caught'
            ? 'Caught!'
            : s.phase === 'landed'
              ? 'Landed on the platform.'
              : 'Booster lost.'}
      </p>
      <dl className="facts">
        <dt>{v.target.mode === 'catch' ? 'Height above catch point' : 'Altitude'}</dt>
        <dd>
          {Math.abs(v.heightAboveM) >= 10_000
            ? `${fmt(v.heightAboveM / 1000, 1)} km`
            : `${fmt(v.heightAboveM)} m`}
        </dd>
        <dt>Distance to target</dt>
        <dd>
          {Math.abs(toGo) >= 2_000
            ? `${fmt(Math.abs(toGo) / 1000, 1)} km`
            : `${fmt(Math.abs(toGo))} m`}{' '}
          {toGo >= 0 ? 'downrange' : 'uprange'}
        </dd>
        <dt>Horizontal / vertical</dt>
        <dd>
          {fmt(s.vx)} / {fmt(s.vy)} m/s
        </dd>
        <dt>Engines · throttle</dt>
        <dd>
          {s.enginesLit} lit · {formatPercent(s.throttle)}
        </dd>
        <dt>Propellant left</dt>
        <dd className={reserve < 0.01 ? 'tone-warn' : undefined}>{fmt(s.propKg / 1000, 1)} t</dd>
        <dt>Grid fins · legs</dt>
        <dd>
          {s.fins >= 1 ? 'out' : s.fins > 0 ? 'deploying' : 'stowed'} ·{' '}
          {s.legs >= 1 ? 'down' : s.legs > 0 ? 'deploying' : 'stowed'}
        </dd>
        <dt>Engine-bay heating</dt>
        <dd>{fmt(s.heatLoadJm2 / 1e6, 2)} MJ/m²</dd>
      </dl>
      <p className="small-text muted">
        {v.target.mode === 'catch' ? 'Catch window' : 'Safe touchdown'}: within {fmt(limits.missM)}{' '}
        m, ≤ {fmt(limits.vertMS)} m/s down, ≤ {fmt(limits.horizMS)} m/s drift, ≤{' '}
        {fmt(limits.tiltDeg)}° tilt.
      </p>
      {flying && (
        <div className="actions">
          <button
            type="button"
            className={v.manualRequested ? 'primary' : undefined}
            aria-pressed={v.manualRequested}
            disabled={!canManual}
            title={
              canManual
                ? 'Fly the landing burn yourself for a bonus'
                : 'Available in the final descent (below 9 km).'
            }
            onClick={() => launchRuntime.setManualLanding(!v.manualRequested)}
          >
            {v.manualRequested ? 'Manual landing: ON' : 'Fly the landing myself'}
          </button>
          <button
            type="button"
            onClick={() => launchRuntime.skipRecovery()}
            disabled={v.manualRequested}
            title={
              v.manualRequested
                ? 'Hand back to the assist first.'
                : 'Simulate the rest of the recovery instantly (assisted).'
            }
          >
            Skip replay
          </button>
        </div>
      )}
      {flying && v.manualRequested && (
        <div className="manual-pad" aria-live="polite">
          <span className="small-text">
            {manualActive ? 'You have control.' : 'You take over at landing-burn ignition.'}{' '}
            <kbd>Shift</kbd>/<kbd>Ctrl</kbd> throttle · <kbd>A</kbd>/<kbd>D</kbd> tilt up-/downrange
            · slider for touch.
          </span>
          <label className="small-text">
            Thrust {formatPercent(v.manualInput.throttle)} (
            {v.manualInput.throttle <= 1 / 3 ? '1 engine' : '3 engines'}) · tilt{' '}
            {fmt(v.manualInput.tiltDeg)}°
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(v.manualInput.throttle * 100)}
              onChange={(e) => launchRuntime.setBoosterThrottle(Number(e.target.value) / 100)}
              aria-label="Booster thrust"
            />
          </label>
        </div>
      )}
      <ol className="event-log" aria-live="polite">
        {[...s.events]
          .reverse()
          .slice(0, 6)
          .map((e, i) => (
            <li key={`${e.tS}-${i}`} className={`ev-${e.kind}`}>
              <span className="muted">T+{fmt(e.tS)}s</span> {e.text}
            </li>
          ))}
      </ol>
      <p className="footnote">Simplified 2D recovery model; game values.</p>
    </div>
  );
}
