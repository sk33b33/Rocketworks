import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { DEPOT_TOPUP_CREDITS, TANKER_FLIGHT_CREDITS } from '../../moon/lunarRules';
import { formatCredits } from '../format';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Moon missions: tanker flights in Earth orbit, the lunar depot top-up, and Δv per leg. */
export function RefuelSection() {
  const report = useGameStore(selectMissionReport);
  const refuel = useGameStore((s) => s.mission.refuel);
  const setRefuel = useGameStore((s) => s.setRefuel);
  const logistics = useGameStore((s) => s.progression.tech.includes('lunar-logistics'));
  const rules = report.mission.lunar;
  if (!rules) return null;
  const legs = report.lunarLegs ?? [];
  const hasDepotLeg = rules.legs.some((l) => l.refuel === 'depot');
  return (
    <fieldset className="stacked section-gap">
      <legend className="eyebrow">Refuelling</legend>
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
            {formatCredits(TANKER_FLIGHT_CREDITS)} · fills the ship before trans-lunar injection
          </span>
        </span>
      </label>
      {hasDepotLeg && (
        <label>
          <input
            type="checkbox"
            checked={refuel.depot}
            onChange={(e) => setRefuel('depot', e.target.checked)}
          />
          <span>
            Lunar depot top-up{' '}
            <span className="muted">
              · {formatCredits(Math.round(DEPOT_TOPUP_CREDITS * (logistics ? 0.6 : 1)))} · a
              fictional depot in lunar orbit, stocked by uncrewed tankers; fills the ship before the
              descent
            </span>
          </span>
        </label>
      )}
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
              <tr key={c.leg.id} className={c.ok ? 'tone-ok' : 'tone-bad'}>
                <td>
                  {c.ok ? '✓' : '✕'} {c.leg.label}
                </td>
                <td>{fmt(c.availableMS)} m/s</td>
                <td>{fmt(c.leg.requiredDvMS)} m/s</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small-text muted">
        Refuelling costs {formatCredits(report.cost.refuelCredits)} for this mission (included in
        the mission cost). Δv figures are estimates for a simplified model.
      </p>
    </fieldset>
  );
}
