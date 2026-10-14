import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { marsPhaseLabel } from '../../mars/marsFlight';
import { DAY_S } from '../../mars/solarSystem';
import { fmt, formatDuration } from '../flight/useFlight';
import { shipDeltaV } from './marsDv';

const days = (s: number) => `${fmt(s / DAY_S, s < 10 * DAY_S ? 1 : 0)} days`;

/** The way home from Mars: ascent, Mars orbit, the return window, the burn and the cruise. */
export function MarsReturnPanel({ snap }: { snap: FlightSnapshot }) {
  const mars = snap.mars;
  const s = flightRuntime.liveState ?? snap.state;
  const spec = snap.context?.spec;
  if (!mars || !s || !spec || mars.leg !== 'home') return null;
  const g = mars.guidance;
  const p = mars.progress;
  const w = mars.returnWindow;
  const el = mars.marsElements;
  const t = s.tS;
  const stage = !p.marsOrbit
    ? 'ASCENT'
    : !p.tei
      ? 'MARS ORBIT'
      : p.leftMarsT === null
        ? 'LEAVING MARS'
        : p.earthArrivedT === null
          ? 'CRUISE HOME'
          : 'EARTH APPROACH';
  let next: string;
  if (!p.marsOrbit)
    next =
      g.program === 'mars-ascent'
        ? 'The ascent program is flying the climb to orbit.'
        : 'Engage Mars ascent to climb to a 200 km orbit.';
  else if (!p.tei)
    next = w?.open
      ? 'The return window is open: engage Trans-Earth injection.'
      : `Wait in orbit for the return window (time warp up to 100,000×), then engage Trans-Earth injection.`;
  else if (p.leftMarsT === null) next = 'Coasting out of Mars’s sphere of influence.';
  else if (p.earthArrivedT === null)
    next = 'Cruise navigation corrects the course for the aerocapture corridor at Earth.';
  else next = 'Approaching Earth: the aerocapture is flown at Flight / Orbit.';
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>The way home</h2>
        <span className="badge">{stage}</span>
      </div>
      <dl className="facts">
        <dt>Guidance</dt>
        <dd>{g.program === 'none' ? 'Off' : marsPhaseLabel(g, 'home')}</dd>
        {el && s.origin === 'mars' && el.status === 'orbit' && el.periapsisAltM > 0 && (
          <>
            <dt>Mars orbit</dt>
            <dd>
              {fmt(el.apoapsisAltM / 1000)} × {fmt(el.periapsisAltM / 1000)} km
            </dd>
          </>
        )}
        <dt>Propellant</dt>
        <dd>
          {fmt(s.propKg / 1000)} t · Δv {fmt(shipDeltaV(spec, s.propKg))} m/s
        </dd>
        {w && !p.tei && (
          <>
            <dt>Return window</dt>
            <dd className={w.open ? 'tone-ok' : undefined}>
              {w.open
                ? `Open until day ${fmt(Math.floor(w.closesDay))}`
                : `Opens in ${fmt(Math.ceil(w.opensInDays))} days (day ${fmt(Math.ceil(w.opensDay))})`}
            </dd>
            {w.today && (
              <>
                <dt>Burn home today</dt>
                <dd>
                  {fmt(w.today.tmiDvMS)} m/s · {fmt(w.today.tofS / DAY_S)} days to Earth
                </dd>
              </>
            )}
          </>
        )}
        {g.tei && g.phase === 'wait' && (
          <>
            <dt>Trans-Earth burn</dt>
            <dd>
              {fmt(g.tei.dvMS)} m/s in {formatDuration(Math.max(0, g.tei.burnStartT - t))}
            </dd>
          </>
        )}
        {mars.arrival && (
          <>
            <dt>Earth arrival</dt>
            <dd>in {days(Math.max(0, mars.arrival.closestT - t))}</dd>
            <dt>Aim at Earth</dt>
            <dd>
              {Math.abs(mars.arrival.aimErrorKm) < 1_000
                ? 'On the aerocapture corridor'
                : `${fmt(Math.abs(mars.arrival.aimErrorKm))} km off (corrections will fix it)`}
            </dd>
          </>
        )}
        {mars.earthAltitudeM !== null && (
          <>
            <dt>Earth altitude</dt>
            <dd>{fmt(mars.earthAltitudeM / 1000)} km</dd>
          </>
        )}
      </dl>
      <p className="small-text muted">{next}</p>
    </div>
  );
}
