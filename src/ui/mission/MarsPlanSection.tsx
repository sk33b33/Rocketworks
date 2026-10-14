import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { TANKER_FLIGHT_CREDITS } from '../../moon/lunarRules';
import { programDay } from '../../progression/research';
import { DAY_S } from '../../mars/solarSystem';
import { formatCredits } from '../format';
import type { MarsRoundTripPlan } from '../../missions/missionReadiness';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Mars missions: the Earth–Mars launch window on the program calendar. */
export function MarsWindowCard() {
  const report = useGameStore(selectMissionReport);
  const day = useGameStore((s) => programDay(s.progression));
  const runFix = useGameStore((s) => s.runMissionFix);
  const w = report.mars?.window;
  if (!w) return null;
  const t = w.today;
  return (
    <div className={`panel-sub section-gap ${w.open ? 'tone-ok' : ''}`}>
      <div className="eyebrow">Earth–Mars launch window</div>
      <dl className="facts">
        <dt>Today</dt>
        <dd>Program day {fmt(day)}</dd>
        <dt>Window</dt>
        <dd>
          {w.open ? 'OPEN' : `Opens in ${fmt(w.opensInDays)} days`} · day{' '}
          {fmt(Math.ceil(w.opensDay))}–{fmt(Math.floor(w.closesDay))} (best day{' '}
          {fmt(Math.round(w.bestDay))})
        </dd>
        {t && (
          <>
            <dt>Departing today</dt>
            <dd>
              {fmt(t.tmiDvMS)} m/s injection · {fmt(t.tofS / DAY_S)}-day cruise · Mars entry at{' '}
              {(t.entrySpeedMS / 1000).toFixed(1)} km/s
            </dd>
          </>
        )}
      </dl>
      {!w.open && (
        <button
          type="button"
          className="primary"
          onClick={() => runFix({ kind: 'wait-mars-window', toDay: Math.ceil(w.opensDay) })}
        >
          Wait {fmt(Math.ceil(w.opensDay) - day)} days for the window
        </button>
      )}
      <p className="small-text muted">
        Earth and Mars line up for a low-energy transfer about every 26 months; waiting moves the
        whole program&apos;s calendar forward. In this simplified, circular solar system every
        window is the same.
      </p>
    </div>
  );
}

/** Mars missions: tanker flights before injection, and Δv per leg after reaching orbit. */
export function MarsPlanSection() {
  const report = useGameStore(selectMissionReport);
  const refuel = useGameStore((s) => s.mission.refuel);
  const setRefuel = useGameStore((s) => s.setRefuel);
  if (!report.mars) return null;
  const legs = report.mars.legs ?? [];
  return (
    <fieldset className="stacked section-gap">
      <legend className="eyebrow">Mars plan</legend>
      <MarsWindowCard />
      <label>
        <input
          type="checkbox"
          checked={refuel.leo}
          onChange={(e) => setRefuel('leo', e.target.checked)}
        />
        <span>
          Tankers in low Earth orbit{' '}
          <span className="muted">
            · {report.cost.tankerFlights} flight{report.cost.tankerFlights === 1 ? '' : 's'} ×{' '}
            {formatCredits(TANKER_FLIGHT_CREDITS)} · fills the ship before trans-Mars injection
          </span>
        </span>
      </label>
      {legs.length > 0 && (
        <table className="leg-table">
          <caption className="sr-only">Δv per leg after reaching orbit</caption>
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Available</th>
              <th scope="col">Needed</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((c) => (
              <tr key={c.id} className={c.ok ? 'tone-ok' : 'tone-bad'}>
                <td>
                  {c.ok ? '✓' : '✕'} {c.label}
                </td>
                <td>{fmt(c.availableMS)} m/s</td>
                <td>{fmt(c.requiredDvMS)} m/s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.mars.roundTrip && <RoundTripCard trip={report.mars.roundTrip} />}
      <p className="small-text muted">
        Refuelling costs {formatCredits(report.cost.refuelCredits)} for this mission (included in
        the mission cost). The landing leg covers the hardest site (thin air at high elevation). Δv
        figures are estimates for a simplified model.
      </p>
    </fieldset>
  );
}

/** Crewed round trips: the stay on Mars, the plant's stock and the legs home. */
function RoundTripCard({ trip }: { trip: MarsRoundTripPlan }) {
  const enough = trip.stockKg >= trip.neededKg;
  return (
    <div className="section-gap">
      <div className="eyebrow">The way home</div>
      <dl className="facts">
        <dt>Arrive at Mars</dt>
        <dd>day {fmt(trip.arrivalDay)}</dd>
        <dt>Return window</dt>
        <dd>
          days {fmt(Math.ceil(trip.returnOpensDay))}–{fmt(Math.floor(trip.returnClosesDay))} · about{' '}
          {fmt(trip.stayDays)} days on Mars
        </dd>
        <dt>Home</dt>
        <dd>about day {fmt(trip.homeDay)}</dd>
        <dt>Propellant plant</dt>
        <dd className={trip.base ? (enough ? 'tone-ok' : 'tone-warn') : 'tone-bad'}>
          {trip.base
            ? `${trip.base.siteName}: ${fmt(trip.stockKg / 1000)} t by the window · ${fmt(trip.neededKg / 1000)} t needed`
            : 'None running yet'}
        </dd>
      </dl>
      <table className="leg-table">
        <caption className="sr-only">Δv per leg home, on tanks filled at the plant</caption>
        <thead>
          <tr>
            <th scope="col">Leg home</th>
            <th scope="col">Available</th>
            <th scope="col">Needed</th>
          </tr>
        </thead>
        <tbody>
          {trip.legs.map((c) => (
            <tr key={c.id} className={c.ok ? 'tone-ok' : 'tone-bad'}>
              <td>
                {c.ok ? '✓' : '✕'} {c.label}
              </td>
              <td>{fmt(c.availableMS)} m/s</td>
              <td>{fmt(c.requiredDvMS)} m/s</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small-text muted">
        Legs home assume full tanks from the plant. The crew lands within 2 km of the plant to run a
        propellant line, and waits on the surface (or in orbit) for the return window.
      </p>
    </div>
  );
}
