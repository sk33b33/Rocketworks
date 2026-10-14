import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { MANUAL_MARS_ALT_M, MARS_DESCENT_LABELS } from '../../mars/marsEntry';
import { MARS } from '../../mars/marsModel';
import { TerrainStrip } from '../moon/TerrainStrip';
import { fmt } from '../flight/useFlight';

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'done' : 'current'}>
      <span className="check" aria-hidden="true">
        {ok ? '✓' : '○'}
      </span>
      <span>{label}</span>
    </li>
  );
}

const dist = (m: number) => (Math.abs(m) >= 10_000 ? `${fmt(m / 1000, 1)} km` : `${fmt(m)} m`);

/** Entry and landing telemetry over the site: heating, heights, speeds and the touchdown window. */
export function MarsDescentPanel({ snap }: { snap: FlightSnapshot }) {
  const mars = snap.mars;
  const s = flightRuntime.liveState ?? snap.state;
  const geo = mars?.geometry;
  if (!mars || !s || !geo) return null;
  const flying = snap.phase === 'voyage' && s.phase === 'flight';
  const d = mars.descent;
  const aim = d?.aimX ?? 0;
  const x = geo.x;
  const near = x !== null && Math.abs(x) < 30_000;
  const slope = x !== null && near ? mars.terrain.slopeAt(x) : 0;
  const tilt = Math.abs(((s.pitchDeg - 90 + 540) % 360) - 180);
  const assisted = snap.program.program === 'mars-entry';
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Entry and landing</h2>
        <span className="badge">{d ? MARS_DESCENT_LABELS[d.phase].toUpperCase() : 'MANUAL'}</span>
      </div>
      <dl className="facts approach-facts">
        <dt>Height above ground</dt>
        <dd>{dist(geo.radarM)}</dd>
        <dt>Speed</dt>
        <dd>{fmt(geo.speed)} m/s</dd>
        <dt>Vertical speed</dt>
        <dd
          className={
            geo.radarM < 200 && -geo.vh > MARS.touchdownMaxVertMS * 2 ? 'tone-bad' : undefined
          }
        >
          {fmt(geo.vh, 1)} m/s
        </dd>
        <dt>To target</dt>
        <dd>{x === null ? '—' : dist(aim - x)}</dd>
        {s.heatFluxWm2 > 0 && (
          <>
            <dt>Heating</dt>
            <dd>
              {fmt(s.heatFluxWm2 / 1000)} kW/m² · shield {fmt(s.shield * 100)}%
            </dd>
          </>
        )}
        {d?.phase === 'entry' && (
          <>
            <dt>Bank (lift steering)</dt>
            <dd>
              {fmt(d.bankDeg)}°
              {d.predictedMissM !== null
                ? ` · predicted ${dist(Math.abs(d.predictedMissM))} ${d.predictedMissM >= 0 ? 'long' : 'short'}`
                : ''}
            </dd>
          </>
        )}
        <dt>Tilt from vertical</dt>
        <dd>{fmt(tilt, 1)}°</dd>
      </dl>
      {near && x !== null && geo.radarM < 20_000 && (
        <TerrainStrip
          terrain={mars.terrain}
          fromM={Math.min(-800, x - 300)}
          toM={Math.max(800, x + 300)}
          aimM={aim}
          ship={{ x, heightM: geo.h - mars.site.elevationM }}
        />
      )}
      <div className="eyebrow section-gap">Touchdown window</div>
      <ul className="checklist">
        <Check
          ok={-geo.vh <= MARS.touchdownMaxVertMS}
          label={`Descending ≤ ${MARS.touchdownMaxVertMS} m/s`}
        />
        <Check
          ok={Math.abs(geo.vx) <= MARS.touchdownMaxHorizMS}
          label={`Ground speed ≤ ${MARS.touchdownMaxHorizMS} m/s`}
        />
        <Check ok={tilt + slope <= MARS.maxLeanDeg} label={`Tilt + slope ≤ ${MARS.maxLeanDeg}°`} />
      </ul>
      {flying && assisted && geo.radarM > MANUAL_MARS_ALT_M && (
        <button type="button" onClick={() => flightRuntime.setMode('manual')}>
          Take over (manual landing)
        </button>
      )}
      <p className="small-text muted">
        {assisted
          ? `Guidance flies the entry and landing. Take over above ${MANUAL_MARS_ALT_M} m (or press W/S/Shift/Ctrl) and fly the rest for a manual landing.`
          : 'Manual: W/S pitch, Shift/Ctrl throttle (one engine throttles down to 15% to hover). Re-engage “Mars entry and landing” to hand back.'}
      </p>
    </div>
  );
}
