import { useMemo, useState } from 'react';
import { selectGuide, useGameStore } from '../../app/gameStore';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { formatCredits, formatForce, formatMass, formatPercent, formatTime } from '../format';

function twrStatus(twr: number | null): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (twr === null) return { label: '— no booster engines', tone: 'bad' };
  if (twr < 1) return { label: `${twr.toFixed(2)} ✕ cannot lift off`, tone: 'bad' };
  if (twr < 1.2) return { label: `${twr.toFixed(2)} ! marginal`, tone: 'warn' };
  return { label: `${twr.toFixed(2)} ✓`, tone: 'ok' };
}

/** Live vehicle statistics derived from the blueprint, plus save controls. */
export function StatsPanel() {
  const blueprint = useGameStore((s) => s.blueprint);
  const saveStatus = useGameStore((s) => s.saveStatus);
  const resetBuild = useGameStore((s) => s.resetBuild);
  const loadReference = useGameStore((s) => s.loadReferenceDesign);
  const guide = useGameStore(selectGuide);
  const stats = useMemo(() => calculateRocketStats(blueprint), [blueprint]);
  const [confirm, setConfirm] = useState<'reset' | 'reference' | null>(null);
  const twr = twrStatus(stats.liftoffTwr);

  return (
    <div className="panel stats">
      <div className="panel-header">
        <h2>Vehicle stats</h2>
        <span className="muted">{stats.partCount} parts</span>
      </div>
      <div className="completeness">
        <div className="row">
          <span>Build completeness</span>
          <strong>{formatPercent(guide.completeness)}</strong>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Build completeness"
          aria-valuenow={Math.round(guide.completeness * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-fill" style={{ width: formatPercent(guide.completeness) }} />
        </div>
      </div>
      <dl className="facts">
        <dt>Dry mass</dt>
        <dd>{formatMass(stats.dryMassKg)}</dd>
        <dt>Propellant capacity</dt>
        <dd>{formatMass(stats.propellantKg)}</dd>
        <dt>Liftoff mass</dt>
        <dd>{formatMass(stats.wetMassKg)}</dd>
        <dt>Booster thrust</dt>
        <dd>
          {formatForce(stats.booster.thrustN)}{' '}
          <span className="muted">({stats.booster.engineCount} eng.)</span>
        </dd>
        <dt>Ship thrust</dt>
        <dd>
          {formatForce(stats.ship.thrustN)}{' '}
          <span className="muted">({stats.ship.engineCount} eng.)</span>
        </dd>
        <dt>Liftoff TWR</dt>
        <dd className={`tone-${twr.tone}`}>{twr.label}</dd>
        <dt>Crew capacity</dt>
        <dd>{stats.crewCapacity}</dd>
        <dt>Estimated cost</dt>
        <dd>{formatCredits(stats.costCredits)}</dd>
      </dl>
      <p className="footnote">
        Simplified game values, not engineering data. TWR uses sea-level thrust and a full
        propellant load.
      </p>
      <div className="save-row">
        <span className={`save-status save-${saveStatus.state}`} role="status">
          {saveStatus.state === 'saved' && `✓ Autosaved ${formatTime(saveStatus.at)}`}
          {saveStatus.state !== 'saved' && `! ${saveStatus.message ?? ''}`}
        </span>
      </div>
      {confirm ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm">
          <p>
            {confirm === 'reset'
              ? 'Discard this build and start over from the booster engine section?'
              : 'Replace this build with the complete reference design?'}
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              autoFocus
              onClick={() => {
                if (confirm === 'reset') resetBuild();
                else loadReference();
                setConfirm(null);
              }}
            >
              {confirm === 'reset' ? 'Reset build' : 'Load design'}
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setConfirm('reset')}>
            Reset build
          </button>
          <button type="button" onClick={() => setConfirm('reference')}>
            Load reference design
          </button>
        </div>
      )}
    </div>
  );
}
