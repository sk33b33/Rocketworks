import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { REFUEL } from '../../moon/lunarFlight';
import { formatPercent } from '../format';
import { fmt, formatDuration } from '../flight/useFlight';

const km = (m: number) => `${fmt(m / 1000)} km`;

/** Where the Moon trip stands: phase, distances, the next event and refuelling. */
export function LunarPanel({
  snap,
  showGoTo = true,
}: {
  snap: FlightSnapshot;
  showGoTo?: boolean;
}) {
  const goTo = useGameStore((s) => s.goTo);
  const lunar = snap.lunar;
  const s = flightRuntime.liveState ?? snap.state;
  if (!lunar || !s) return null;
  const t = s.tS;
  const g = lunar.guidance;
  const p = lunar.progress;
  const surface = !!lunar.surface;
  const phase = surface
    ? `On the Moon (${lunar.site.name})`
    : s.ref === 'moon'
      ? lunar.inLunarOrbit && lunar.moonElements
        ? `Lunar orbit ${fmt(lunar.moonElements.apoapsisAltM / 1000)} × ${fmt(lunar.moonElements.periapsisAltM / 1000)} km`
        : 'Near the Moon'
      : p.tli && !p.earthReturn
        ? p.soi
          ? 'Coasting home'
          : 'Coasting to the Moon'
        : 'Earth orbit';
  const refuel = lunar.refuel;
  const avail = lunar.refuelAvailable;
  const flying = snap.phase === 'flight' && s.phase === 'flight';
  const remaining =
    (lunar.plan.refuel.leo && !p.refuelLeo) || (lunar.plan.refuel.depot && !p.refuelDepot);
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Moon</h2>
        <span className="badge">{lunar.plan.landing ? 'LANDING' : 'FLYBY'}</span>
      </div>
      <dl className="facts">
        <dt>Status</dt>
        <dd>{phase}</dd>
        <dt>Moon altitude</dt>
        <dd>{surface ? '0 km' : km(lunar.moonAltitudeM)}</dd>
        {g.pass && !p.soi && (
          <>
            <dt>Closest approach</dt>
            <dd>
              {km(g.pass.periAltM)} in {formatDuration(Math.max(0, g.pass.periT - t))}
            </dd>
          </>
        )}
        {g.ret && p.soi && !p.earthReturn && (
          <>
            <dt>Return perigee</dt>
            <dd>
              {km(g.ret.perigeeAltM)} in {formatDuration(Math.max(0, g.ret.perigeeT - t))}
            </dd>
          </>
        )}
        {g.mccT !== null && g.phase === 'coast' && (
          <>
            <dt>Course check</dt>
            <dd>in {formatDuration(Math.max(0, g.mccT - t))}</dd>
          </>
        )}
        {lunar.plan.landing && (
          <>
            <dt>Landing site</dt>
            <dd>{lunar.site.name}</dd>
          </>
        )}
      </dl>
      {(lunar.plan.refuel.leo || lunar.plan.refuel.depot) && (
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
                {refuel.kind === 'leo'
                  ? 'Tankers transferring propellant'
                  : 'Topping up at the depot'}{' '}
                · {formatDuration(Math.max(0, refuel.endT - t))} left (time warp is available)
              </p>
            </>
          ) : remaining && !surface ? (
            <>
              <button
                type="button"
                className={avail.ok ? 'primary' : undefined}
                disabled={!avail.ok || !flying}
                title={avail.ok ? undefined : avail.reason}
                onClick={() => flightRuntime.refuel()}
              >
                {avail.kind === 'depot' || s.ref === 'moon' || p.refuelLeo
                  ? `Top up at the lunar depot (~${REFUEL.depotDurationS / 3_600} h)`
                  : `Refuel in orbit (~${REFUEL.leoDurationS / 3_600} h)`}
              </button>
              {!avail.ok && avail.reason && <p className="small-text muted">{avail.reason}</p>}
              {avail.ok && snap.program.program !== 'none' && (
                <p className="small-text muted">Switch the autopilot off first.</p>
              )}
            </>
          ) : null}
          <p className="small-text muted">
            {p.refuelLeo
              ? '✓ Earth-orbit tankers'
              : lunar.plan.refuel.leo
                ? '○ Earth-orbit tankers'
                : ''}
            {lunar.plan.refuel.depot && (p.refuelDepot ? ' · ✓ lunar depot' : ' · ○ lunar depot')}
          </p>
        </>
      )}
      {showGoTo && (s.ref === 'moon' || surface) && (
        <div className="actions section-gap">
          <button type="button" className="primary" onClick={() => goTo('moon')}>
            Go to the Moon location
          </button>
        </div>
      )}
    </div>
  );
}
