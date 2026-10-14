import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { HANDOVER_RANGE_M, RENDEZVOUS_LABELS } from '../../station/rendezvous';
import { STATION_ALT_M } from '../../station/stationOrbit';
import { fmt, formatDuration } from './useFlight';

/** The station as seen from orbital flight: range, rendezvous status and hand-over. */
export function StationPanel({ snap }: { snap: FlightSnapshot }) {
  const goTo = useGameStore((s) => s.goTo);
  const st = snap.station;
  if (!st) return null;
  const avail = flightRuntime.proximityAvailability();
  const active = snap.program.program === 'rendezvous';
  const range = st.view.rangeM;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Station</h2>
        <span className="muted">{fmt(STATION_ALT_M / 1000)} km circular</span>
      </div>
      <dl className="facts">
        <dt>Range</dt>
        <dd>{range >= 10_000 ? `${fmt(range / 1000)} km` : `${fmt(range)} m`}</dd>
        <dt>Relative speed</dt>
        <dd>{fmt(st.view.relSpeedMS, 1)} m/s</dd>
        <dt>Rendezvous</dt>
        <dd>
          {active ? RENDEZVOUS_LABELS[snap.rendezvous.phase] : 'Program off'}
          {active && st.view.toBurnS != null && snap.rendezvous.phase === 'phasing' && (
            <span className="muted"> · burn in {formatDuration(st.view.toBurnS)}</span>
          )}
        </dd>
      </dl>
      <div className="actions">
        <button
          type="button"
          className={avail.ok ? 'primary' : undefined}
          disabled={!avail.ok}
          title={avail.ok ? undefined : avail.reason}
          onClick={() => {
            if (flightRuntime.beginProximity().ok) goTo('station');
          }}
        >
          Begin proximity operations
        </button>
      </div>
      {!avail.ok && <p className="small-text muted">{avail.reason}</p>}
      <p className="footnote">
        Hand-over within {fmt(HANDOVER_RANGE_M / 1000, 1)} km. Fictional station; simplified planar
        rendezvous.
      </p>
    </div>
  );
}
