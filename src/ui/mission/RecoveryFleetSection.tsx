import { useState } from 'react';
import { selectMissionReport, useGameStore } from '../../app/gameStore';
import {
  compatibleVehicles,
  FLEET,
  isRetired,
  stageCost,
  stageFlightCost,
  type FleetVehicle,
  type HardwareKind,
} from '../../fleet/fleet';
import {
  boosterHardware,
  RECOVERY_LABELS,
  recoveryAvailability,
  RESERVE_FRACTION,
  type RecoveryTarget,
} from '../../recovery/recoveryPlan';
import type { RocketBlueprint } from '../../rocket/model/types';
import { formatCredits, formatPercent } from '../format';

const TARGETS: RecoveryTarget[] = ['catch', 'platform', 'expend'];

function VehicleChoice({ kind, bp }: { kind: HardwareKind; bp: RocketBlueprint }) {
  const fleet = useGameStore((s) => s.fleet);
  const selected = useGameStore((s) =>
    kind === 'booster' ? s.mission.boosterFleetId : s.mission.shipFleetId,
  );
  const rapid = useGameStore((s) => s.progression.tech.includes('rapid-reuse'));
  const assign = useGameStore((s) => s.assignFleet);
  const options = compatibleVehicles(fleet, bp, kind);
  const newCost = stageCost(bp, kind);
  const label = kind === 'booster' ? 'Booster' : 'Ship';
  return (
    <fieldset className="stacked">
      <legend className="eyebrow">{label} hardware</legend>
      <label>
        <input
          type="radio"
          name={`hw-${kind}`}
          checked={!selected}
          onChange={() => assign(kind, null)}
        />
        <span>
          New build <span className="muted">· {formatCredits(newCost)}</span>
        </span>
      </label>
      {options.map((v) => (
        <label key={v.id}>
          <input
            type="radio"
            name={`hw-${kind}`}
            checked={selected === v.id}
            onChange={() => assign(kind, v.id)}
          />
          <span>
            {v.name}{' '}
            <span className="muted">
              · {v.flights} flight{v.flights === 1 ? '' : 's'} · wear {formatPercent(v.wear)}
              {v.refurbPending ? ' · refurbished' : ''} ·{' '}
              {formatCredits(stageFlightCost(newCost, v, rapid))}
            </span>
          </span>
        </label>
      ))}
      {options.length === 0 && (
        <p className="small-text muted">
          No recovered {kind === 'booster' ? 'boosters' : 'ships'} match this design yet. Recover
          one to fly it again for a fraction of the cost.
        </p>
      )}
    </fieldset>
  );
}

function FleetList() {
  const fleet = useGameStore((s) => s.fleet);
  const refurbish = useGameStore((s) => s.refurbishVehicle);
  const scrapVehicle = useGameStore((s) => s.scrapVehicle);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (fleet.length === 0) return null;
  const sorted: FleetVehicle[] = [...fleet].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'booster' ? -1 : 1,
  );
  return (
    <details className="section-gap">
      <summary>Fleet ({fleet.length})</summary>
      <ul className="fleet-list">
        {sorted.map((v) => (
          <li key={v.id}>
            <div className="row">
              <strong>{v.name}</strong>
              <span className={isRetired(v) ? 'tone-bad' : v.wear >= 0.5 ? 'tone-warn' : 'muted'}>
                {isRetired(v) ? 'worn out' : `wear ${formatPercent(v.wear)}`}
              </span>
            </div>
            <div className="small-text muted">
              {v.kind === 'booster' ? 'Booster' : 'Ship'} of "{v.designName}" · {v.flights} flight
              {v.flights === 1 ? '' : 's'}
              {v.lastGrade ? ` · last landing ${v.lastGrade}` : ''}
            </div>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => refurbish(v.id)}
                disabled={v.wear === 0}
                title={
                  v.wear === 0
                    ? 'Already like new.'
                    : `Resets wear; the next flight pays ${Math.round(FLEET.refurbishShare * 100)}% of a new build on top of the reflight cost.`
                }
              >
                Refurbish
              </button>
              {confirm === v.id ? (
                <>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      scrapVehicle(v.id);
                      setConfirm(null);
                    }}
                  >
                    Confirm scrap
                  </button>
                  <button type="button" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="danger" onClick={() => setConfirm(v.id)}>
                  Scrap
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Booster recovery plan, reflown hardware and the mission's hardware cost. */
export function RecoveryFleetSection({ bp }: { bp: RocketBlueprint | undefined }) {
  const setup = useGameStore((s) => s.mission);
  const report = useGameStore(selectMissionReport);
  const setRecovery = useGameStore((s) => s.setRecovery);
  const hw = bp ? boosterHardware(bp) : { gridFins: 0, boosterLegs: 0 };
  const cost = report.cost;
  const over = cost.budgetCredits !== null && cost.missionCredits > cost.budgetCredits;
  return (
    <div className="recovery-section">
      <fieldset className="stacked">
        <legend className="eyebrow">Booster recovery</legend>
        <label>
          <input
            type="radio"
            name="recovery"
            checked={setup.recovery === null}
            onChange={() => setRecovery(null)}
          />
          <span>
            Automatic{' '}
            <span className="muted">· best option the hardware allows ({report.recovery})</span>
          </span>
        </label>
        {TARGETS.map((t) => {
          const avail = recoveryAvailability(t, hw);
          return (
            <label key={t} title={avail.ok ? undefined : avail.reason}>
              <input
                type="radio"
                name="recovery"
                checked={setup.recovery === t}
                disabled={!avail.ok}
                onChange={() => setRecovery(t)}
              />
              <span>
                {RECOVERY_LABELS[t]}{' '}
                <span className="muted">
                  {t === 'expend'
                    ? '· no propellant held back'
                    : `· holds back ${Math.round(RESERVE_FRACTION[t] * 100)}% of booster propellant`}
                </span>
                {!avail.ok && <span className="small-text tone-warn"> · {avail.reason}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {bp && <VehicleChoice kind="booster" bp={bp} />}
      {bp && <VehicleChoice kind="ship" bp={bp} />}
      <dl className="facts">
        <dt>New-build cost</dt>
        <dd>{formatCredits(cost.newBuildCredits)}</dd>
        <dt>This mission's hardware</dt>
        <dd
          className={
            over ? 'tone-bad' : cost.missionCredits < cost.newBuildCredits ? 'tone-ok' : undefined
          }
        >
          {formatCredits(cost.missionCredits)}
        </dd>
        {cost.budgetCredits !== null && (
          <>
            <dt>Program budget (per mission)</dt>
            <dd>{formatCredits(cost.budgetCredits)}</dd>
          </>
        )}
      </dl>
      <FleetList />
    </div>
  );
}
