import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { plantRateKgPerDay } from '../../mars/marsRules';
import { formatPercent } from '../format';
import { fmt, formatDuration } from '../flight/useFlight';
import { returnLegsNow, shipDeltaV } from './marsDv';

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
      {mars.plan.crewed ? <CrewReturn snap={snap} /> : <CargoHandover done={surf.done} />}
    </div>
  );
}

function CargoHandover({ done }: { done: boolean }) {
  return (
    <>
      <div className="actions section-gap">
        <button
          type="button"
          className={done ? 'primary' : undefined}
          disabled={!done}
          title={done ? undefined : 'Finish the surface tasks first.'}
          onClick={() => flightRuntime.endFlight()}
        >
          Complete the mission
        </button>
      </div>
      {!done && (
        <p className="small-text muted">
          The ship stays on Mars. You can end the flight early from the controls, but the mission is
          credited only once the plant is running.
        </p>
      )}
    </>
  );
}

/** Crewed round trips: the propellant line, the return window and lift-off. */
function CrewReturn({ snap }: { snap: FlightSnapshot }) {
  const mars = snap.mars!;
  const s = flightRuntime.liveState ?? snap.state;
  const spec = snap.context?.spec;
  const plant = mars.plant;
  const w = mars.returnWindow;
  if (!s || !spec) return null;
  const cap = spec.stage.propellantKg;
  const legs = returnLegsNow(mars, spec, s.propKg);
  const fuelled = legs.earth.ok;
  const lift = mars.liftOff ?? { ok: false };
  return (
    <>
      <div className="eyebrow section-gap">Propellant plant</div>
      {plant ? (
        <>
          <dl className="facts">
            <dt>Plant stock</dt>
            <dd>
              {fmt(plant.stockKg / 1000)} t · makes {fmt(plant.rateKgPerDay / 1000, 1)} t/day
            </dd>
            <dt>Ship tanks</dt>
            <dd>
              {fmt(s.propKg / 1000)} of {fmt(cap / 1000)} t · Δv {fmt(shipDeltaV(spec, s.propKg))}{' '}
              m/s
            </dd>
          </dl>
          <div
            className="progress"
            role="progressbar"
            aria-label="Ship tanks"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((s.propKg / cap) * 100)}
          >
            <div className="progress-fill" style={{ width: formatPercent(s.propKg / cap) }} />
          </div>
          <div className="actions">
            {plant.op ? (
              <button type="button" onClick={() => flightRuntime.plantRefuel(false)}>
                Close the propellant line
              </button>
            ) : (
              <button
                type="button"
                className={plant.available.ok ? 'primary' : undefined}
                disabled={!plant.available.ok}
                title={plant.available.ok ? undefined : plant.available.reason}
                onClick={() => flightRuntime.plantRefuel(true)}
              >
                Refuel from the plant
              </button>
            )}
          </div>
          {plant.op ? (
            <p className="small-text muted">
              Pumping about 100 t a day (time warp is available, or wait for the return window).
            </p>
          ) : (
            !plant.available.ok &&
            plant.available.reason && <p className="small-text muted">{plant.available.reason}</p>
          )}
        </>
      ) : (
        <p className="small-text tone-bad">No propellant plant: the ship can't refuel here.</p>
      )}
      <div className="eyebrow section-gap">Return window</div>
      {w && (
        <p className={`small-text ${w.open ? 'tone-ok' : ''}`}>
          {w.open
            ? `Open until day ${fmt(Math.floor(w.closesDay))}: lift off and head home.`
            : `Opens on day ${fmt(Math.ceil(w.opensDay))}, in ${fmt(Math.ceil(w.opensInDays))} days. Today is day ${fmt(Math.floor(mars.day))}.`}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={!w || w.open}
          title={w?.open ? 'The window is already open.' : undefined}
          onClick={() => flightRuntime.waitForReturnWindow()}
        >
          {w && !w.open
            ? `Wait for the window (${fmt(Math.ceil(w.opensInDays))} days)`
            : 'Window open'}
        </button>
        <button
          type="button"
          className={lift.ok && fuelled && w?.open ? 'primary' : undefined}
          disabled={!lift.ok}
          title={lift.ok ? undefined : lift.reason}
          onClick={() => flightRuntime.liftOff()}
        >
          Lift off
        </button>
      </div>
      <p className="small-text muted">
        {!fuelled
          ? `Not enough propellant for the way home yet: about ${fmt(legs.ascent.requiredDvMS + legs.transfer.requiredDvMS + legs.earth.requiredDvMS)} m/s needed (ascent, the burn home and the Earth arrival).`
          : w?.open
            ? 'Fuelled for the way home. The ascent program flies the climb to Mars orbit.'
            : 'Fuelled. You can lift off now and wait in Mars orbit, or wait here for the window.'}
      </p>
    </>
  );
}
