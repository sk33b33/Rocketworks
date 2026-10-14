import { useState } from 'react';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { formatPercent } from '../format';
import { formatDuration } from '../flight/useFlight';

/** Surface operations: task progress and lift-off. */
export function SurfacePanel({ snap }: { snap: FlightSnapshot }) {
  const [confirm, setConfirm] = useState(false);
  const lunar = snap.lunar;
  const surf = lunar?.surface;
  if (!lunar || !surf) return null;
  const landing = lunar.progress.landing;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>On the surface</h2>
        <span className={`badge ${surf.done ? 'tone-ok' : ''}`}>
          {surf.done ? 'READY' : 'WORKING'}
        </span>
      </div>
      {landing && (
        <p className="tone-ok">
          {lunar.site.name} · rating {landing.grade ?? '—'}
          {landing.manual ? ' (manual)' : ' (assisted)'} · {Math.round(landing.missM)} m from the
          target
        </p>
      )}
      <ul className="task-list">
        {surf.tasks.map((t, i) => (
          <li key={t.id}>
            <div className="row">
              <span>{t.label}</span>
              <span className="muted small-text">{formatDuration(t.durationS)}</span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label={t.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((surf.progress[i] ?? 0) * 100)}
            >
              <div
                className="progress-fill"
                style={{ width: formatPercent(surf.progress[i] ?? 0) }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="small-text muted">
        On the Moon for {formatDuration(surf.elapsedS)}. Time warp up to 1000× while on the surface.
      </p>
      <div className="actions section-gap">
        {confirm ? (
          <>
            <button
              type="button"
              className="danger"
              autoFocus
              onClick={() => {
                flightRuntime.liftOff();
                setConfirm(false);
              }}
            >
              Lift off now (tasks incomplete)
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className={surf.done ? 'primary' : undefined}
            onClick={() => (surf.done ? flightRuntime.liftOff() : setConfirm(true))}
          >
            Lift off to lunar orbit
          </button>
        )}
      </div>
      {!surf.done && (
        <p className="small-text muted">
          Leaving early is allowed, but the mission is credited only with every task done.
        </p>
      )}
    </div>
  );
}
