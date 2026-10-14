import { flightRuntime } from '../../app/flightBinding';
import { FLIGHT } from '../../flight/flightModel';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { MANUAL_LUNAR_ALT_M } from '../../moon/lunarLanding';
import { fmt } from '../flight/useFlight';
import { TerrainStrip } from './TerrainStrip';

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

/** Descent telemetry over the landing site: heights, speeds, ground under the ship, the touchdown window. */
export function DescentPanel({ snap }: { snap: FlightSnapshot }) {
  const lunar = snap.lunar;
  const s = flightRuntime.liveState ?? snap.state;
  const geo = lunar?.geometry;
  if (!lunar || !s || !geo) return null;
  const flying = snap.phase === 'flight' && s.phase === 'flight';
  const aim = lunar.landing?.kind === 'descent' ? lunar.landing.aimX : 0;
  const toAim = aim - geo.x;
  const slope = lunar.terrain.slopeAt(geo.x);
  const tilt = Math.abs(((s.pitchDeg - 90 + 540) % 360) - 180);
  const assisted = snap.program.program === 'lunar-descent';
  const near = Math.abs(geo.x) < 30_000;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Descent</h2>
        <span className={`badge ${s.landingThrusters ? 'tone-ok' : ''}`}>
          {s.landingThrusters
            ? 'LANDING THRUSTERS'
            : geo.h < FLIGHT.landingThrusterAltM
              ? 'THRUSTERS READY'
              : 'MAIN ENGINES'}
        </span>
      </div>
      <dl className="facts approach-facts">
        <dt>Height above ground</dt>
        <dd>{geo.radarM >= 10_000 ? `${fmt(geo.radarM / 1000, 1)} km` : `${fmt(geo.radarM)} m`}</dd>
        <dt>Vertical speed</dt>
        <dd
          className={
            geo.radarM < 200 && -geo.vh > FLIGHT.lunarTouchdownMaxVertMS * 2
              ? 'tone-bad'
              : undefined
          }
        >
          {fmt(geo.vh, 1)} m/s
        </dd>
        <dt>Ground speed</dt>
        <dd>{fmt(geo.vx, 1)} m/s</dd>
        <dt>To target</dt>
        <dd>{Math.abs(toAim) >= 1_000 ? `${fmt(toAim / 1000, 1)} km` : `${fmt(toAim)} m`}</dd>
        <dt>Ground slope below</dt>
        <dd className={near && slope > FLIGHT.lunarMaxLeanDeg * 0.75 ? 'tone-warn' : undefined}>
          {near ? `${fmt(slope, 1)}°` : '—'}
        </dd>
        <dt>Tilt from vertical</dt>
        <dd>{fmt(tilt, 1)}°</dd>
      </dl>
      {near && (
        <TerrainStrip
          terrain={lunar.terrain}
          fromM={Math.min(-800, geo.x - 300)}
          toM={Math.max(800, geo.x + 300)}
          aimM={aim}
          ship={{ x: geo.x, heightM: geo.h }}
        />
      )}
      <div className="eyebrow section-gap">Touchdown window</div>
      <ul className="checklist">
        <Check
          ok={-geo.vh <= FLIGHT.lunarTouchdownMaxVertMS}
          label={`Descending ≤ ${FLIGHT.lunarTouchdownMaxVertMS} m/s`}
        />
        <Check
          ok={Math.abs(geo.vx) <= FLIGHT.lunarTouchdownMaxHorizMS}
          label={`Ground speed ≤ ${FLIGHT.lunarTouchdownMaxHorizMS} m/s`}
        />
        <Check
          ok={tilt + slope <= FLIGHT.lunarMaxLeanDeg}
          label={`Tilt + slope ≤ ${FLIGHT.lunarMaxLeanDeg}°`}
        />
      </ul>
      {flying && assisted && geo.radarM > MANUAL_LUNAR_ALT_M && (
        <button type="button" onClick={() => flightRuntime.setMode('manual')}>
          Take over (manual landing)
        </button>
      )}
      <p className="small-text muted">
        {assisted
          ? `The assist flies the descent. Take over above ${MANUAL_LUNAR_ALT_M} m (or press W/S/Shift/Ctrl) and fly the rest for a manual landing.`
          : 'Manual: W/S pitch, Shift/Ctrl throttle. Below 3 km the landing thrusters give fine control (about 40% throttle hovers).'}
      </p>
    </div>
  );
}
