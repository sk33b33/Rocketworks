import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { REFUEL } from '../../moon/lunarFlight';
import { marsPhaseLabel } from '../../mars/marsFlight';
import { DAY_S } from '../../mars/solarSystem';
import { formatPercent } from '../format';
import { fmt, formatDuration } from '../flight/useFlight';

const km = (m: number) => `${fmt(m / 1000)} km`;
const days = (s: number) => `${fmt(s / DAY_S, s < 10 * DAY_S ? 1 : 0)} days`;

/** Where the Mars voyage stands: phase, program day, arrival, corrections and refuelling. */
export function MarsPanel({ snap, showGoTo = true }: { snap: FlightSnapshot; showGoTo?: boolean }) {
  const goTo = useGameStore((s) => s.goTo);
  const mars = snap.mars;
  const s = flightRuntime.liveState ?? snap.state;
  if (!mars || !s) return null;
  const t = s.tS;
  const g = mars.guidance;
  const p = mars.progress;
  const refuel = mars.refuel;
  const avail = mars.refuelAvailable;
  const flying = snap.phase === 'flight' && s.phase === 'flight';
  const home = mars.leg === 'home';
  const status = mars.surface
    ? `On Mars (${mars.site.name})`
    : home
      ? mars.frame === 'mars'
        ? p.tei
          ? 'Leaving Mars'
          : p.marsOrbit
            ? 'In Mars orbit'
            : 'Climbing to Mars orbit'
        : mars.frame === 'sun'
          ? 'Cruising home to Earth'
          : 'Back at Earth'
      : mars.frame === 'mars'
        ? 'Approaching Mars'
        : mars.frame === 'sun'
          ? 'Cruising to Mars'
          : p.tmi
            ? 'Leaving Earth'
            : 'Earth parking orbit';
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Mars</h2>
        <span className="badge">
          {g.program === 'none'
            ? mars.plan.crewed
              ? 'CREW'
              : 'CARGO'
            : marsPhaseLabel(g, mars.leg).toUpperCase()}
        </span>
      </div>
      <dl className="facts">
        <dt>Status</dt>
        <dd>{status}</dd>
        <dt>Program day</dt>
        <dd>{fmt(Math.floor(mars.day))}</dd>
        {g.tmi && !p.departedT && (
          <>
            <dt>Injection</dt>
            <dd>
              {fmt(g.tmi.dvMS)} m/s · {fmt(g.tmi.tofS / DAY_S)}-day transfer
            </dd>
          </>
        )}
        {mars.arrival && !home && (
          <>
            <dt>Arrival</dt>
            <dd>in {days(Math.max(0, mars.arrival.closestT - t))}</dd>
            <dt>Aim at Mars</dt>
            <dd>
              {Math.abs(mars.arrival.aimErrorKm) < 1_000
                ? 'On the entry corridor'
                : `${fmt(Math.abs(mars.arrival.aimErrorKm))} km off (corrections will fix it)`}
            </dd>
          </>
        )}
        {g.mccT !== null && g.phase === 'cruise' && (
          <>
            <dt>Next course check</dt>
            <dd>in {days(Math.max(0, g.mccT - t))}</dd>
          </>
        )}
        {p.corrections > 0 && (
          <>
            <dt>Corrections</dt>
            <dd>
              {p.corrections} · {fmt(p.correctionDvMS, 1)} m/s
            </dd>
          </>
        )}
        {mars.marsAltitudeM !== null && !mars.surface && !home && (
          <>
            <dt>Mars altitude</dt>
            <dd>{km(mars.marsAltitudeM)}</dd>
            <dt>Speed (Mars)</dt>
            <dd>{fmt(mars.marsSpeedMS ?? 0)} m/s</dd>
          </>
        )}
        <dt>Landing site</dt>
        <dd>
          {mars.site.name}
          {mars.plan.crewed ? ' (the plant)' : p.siteLocked ? ' (approach set)' : ''}
        </dd>
      </dl>
      {mars.plan.refuelLeo && !p.tmi && (
        <>
          <div className="eyebrow section-gap">Refuelling</div>
          {refuel ? (
            <>
              <div
                className="progress"
                role="progressbar"
                aria-label="Refuelling"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(
                  ((t - refuel.startT) / (refuel.endT - refuel.startT)) * 100,
                )}
              >
                <div
                  className="progress-fill"
                  style={{
                    width: formatPercent(
                      Math.min(1, (t - refuel.startT) / (refuel.endT - refuel.startT)),
                    ),
                  }}
                />
              </div>
              <p className="small-text muted">
                Tankers transferring propellant · {formatDuration(Math.max(0, refuel.endT - t))}{' '}
                left (time warp is available)
              </p>
            </>
          ) : !p.refuelLeo ? (
            <>
              <button
                type="button"
                className={avail.ok ? 'primary' : undefined}
                disabled={!avail.ok || !flying}
                title={avail.ok ? undefined : avail.reason}
                onClick={() => flightRuntime.refuel()}
              >
                Refuel in orbit (~{REFUEL.leoDurationS / 3_600} h)
              </button>
              {!avail.ok && avail.reason && <p className="small-text muted">{avail.reason}</p>}
              {avail.ok && snap.program.program !== 'none' && (
                <p className="small-text muted">Switch the autopilot off first.</p>
              )}
            </>
          ) : (
            <p className="small-text muted">
              ✓ Tanks filled by the tankers. Engage trans-Mars injection.
            </p>
          )}
        </>
      )}
      {showGoTo && (snap.phase === 'voyage' || (snap.phase === 'surface' && !!mars.surface)) && (
        <div className="actions section-gap">
          <button type="button" className="primary" onClick={() => goTo('mars')}>
            Go to the Mars location
          </button>
        </div>
      )}
    </div>
  );
}
