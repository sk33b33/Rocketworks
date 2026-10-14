import { flightRuntime } from '../../app/flightBinding';
import { useGameStore } from '../../app/gameStore';
import type { ProximityView, ProxKey } from '../../station/proximitySession';
import { formatDuration } from '../flight/useFlight';

/** A press-and-hold RCS button for touch and mouse. */
function Hold({ k, label }: { k: ProxKey; label: string }) {
  const on = () => flightRuntime.setProxKey(k, true);
  const off = () => flightRuntime.setProxKey(k, false);
  return (
    <button
      type="button"
      className="rcs-btn"
      onPointerDown={on}
      onPointerUp={off}
      onPointerLeave={off}
      onPointerCancel={off}
      aria-label={label}
      title={label}
    >
      {label}
    </button>
  );
}

/** Assist, attitude modes, RCS pad, tasks and the undock/depart flow. */
export function ProximityControls({ view }: { view: ProximityView }) {
  const goTo = useGameStore((s) => s.goTo);
  const s = view.state;
  const docked = s.phase === 'docked';
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{docked ? 'Docked' : 'Proximity controls'}</h2>
      </div>
      {!docked && (
        <>
          <div className="actions">
            <button
              type="button"
              className={view.assist === 'dock' ? 'primary' : undefined}
              aria-pressed={view.assist === 'dock'}
              onClick={() => flightRuntime.setProxAssist(view.assist === 'dock' ? 'off' : 'dock')}
            >
              Docking assist <kbd>G</kbd>
            </button>
            <button
              type="button"
              className="danger"
              aria-pressed={view.assist === 'abort'}
              onClick={() => flightRuntime.setProxAssist(view.assist === 'abort' ? 'off' : 'abort')}
              title="Back out along the corridor to a safe distance"
            >
              {view.assist === 'abort' ? 'Abort: backing out' : 'Abort'} <kbd>B</kbd>
            </button>
          </div>
          <div className="actions">
            <button
              type="button"
              aria-pressed={view.hold}
              onClick={() => flightRuntime.setProxHold(!view.hold)}
            >
              Attitude hold <kbd>T</kbd>
            </button>
            <button
              type="button"
              aria-pressed={view.align}
              onClick={() => flightRuntime.setProxAlign(!view.align)}
            >
              Align to port <kbd>Y</kbd>
            </button>
          </div>
          <div className="eyebrow section-gap">RCS translation (hold)</div>
          <div className="rcs-pad">
            <span />
            <Hold k="up" label="Up R" />
            <span />
            <Hold k="left" label="Left A" />
            <Hold k="forward" label="Fwd W" />
            <Hold k="right" label="Right D" />
            <span />
            <Hold k="down" label="Down F" />
            <Hold k="back" label="Back S" />
          </div>
          <p className="small-text muted">
            Arrows pitch/yaw, Q/E roll. Any translation key hands control back from the assist.
          </p>
        </>
      )}
      {docked && (
        <>
          {s.docking && (
            <p className="tone-ok">
              Docked · rating{' '}
              <strong className={`grade-${s.docking.grade}`}>{s.docking.grade}</strong>
              {s.docking.manual ? ' (flown manually)' : ' (assisted)'}
            </p>
          )}
          <ul className="task-list">
            {view.tasks.map((t, i) => (
              <li key={t.id}>
                <div className="row">
                  <span>{t.label}</span>
                  <span className="muted small-text">{formatDuration(t.durationS)}</span>
                </div>
                <div
                  className="progress"
                  role="progressbar"
                  aria-label={t.label}
                  aria-valuenow={Math.round((view.taskProgress[i] ?? 0) * 100)}
                >
                  <div
                    className="progress-fill"
                    style={{ width: `${(view.taskProgress[i] ?? 0) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="small-text muted">
            Docked for {formatDuration(view.dockedS)}. Time warp up to 1000× while docked.
          </p>
        </>
      )}
      <div className="actions section-gap">
        {docked && (
          <button
            type="button"
            className="primary"
            disabled={!view.canUndock}
            title={view.canUndock ? undefined : 'Finish the docked tasks first.'}
            onClick={() => flightRuntime.undock()}
          >
            Undock
          </button>
        )}
        {!docked && (
          <button
            type="button"
            className={view.canDepart ? 'primary' : undefined}
            disabled={!view.canDepart}
            title={view.canDepart ? undefined : 'Back out beyond 300 m from the station first.'}
            onClick={() => {
              if (flightRuntime.depart().ok) goTo('flight');
            }}
          >
            Depart: return to orbital flight
          </button>
        )}
      </div>
    </div>
  );
}
