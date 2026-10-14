import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { plantRateKgPerDay } from '../../mars/marsRules';
import { formatPercent } from '../format';
import { fmt, formatDuration } from '../flight/useFlight';

const dur = (s: number) => (s >= 86_400 ? `${fmt(s / 86_400, 1)} days` : formatDuration(s));

/** Surface operations on Mars: task progress, then handing the mission over. */
export function MarsSurfacePanel({ snap }: { snap: FlightSnapshot }) {
  const mars = snap.mars;
  const surf = mars?.surface;
  if (!mars || !surf) return null;
  const landing = mars.progress.landing;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>On Mars</h2>
        <span className={`badge ${surf.done ? 'tone-ok' : ''}`}>
          {surf.done ? 'DONE' : 'WORKING'}
        </span>
      </div>
      {landing && (
        <p className="tone-ok">
          {mars.site.name} · rating {landing.grade ?? '—'}
          {landing.manual ? ' (manual)' : ' (assisted)'} · {Math.round(landing.missM)} m from the
          target
        </p>
      )}
      <ul className="task-list">
        {surf.tasks.map((t, i) => (
          <li key={t.id}>
            <div className="row">
              <span>{t.label}</span>
              <span className="muted small-text">{dur(t.durationS)}</span>
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
        On Mars for {dur(surf.elapsedS)}. Time warp up to 10,000× on the surface.
        {mars.plan.plant &&
          ` Once running, the plant makes about ${fmt(plantRateKgPerDay(mars.site.ice) / 1000, 1)} t of propellant a day for future crews.`}
      </p>
      <div className="actions section-gap">
        <button
          type="button"
          className={surf.done ? 'primary' : undefined}
          disabled={!surf.done}
          title={surf.done ? undefined : 'Finish the surface tasks first.'}
          onClick={() => flightRuntime.endFlight()}
        >
          Complete the mission
        </button>
      </div>
      {!surf.done && (
        <p className="small-text muted">
          The ship stays on Mars. You can end the flight early from the controls, but the mission is
          credited only once the plant is running.
        </p>
      )}
    </div>
  );
}
