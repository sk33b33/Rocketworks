import { formatTMinus, propellantLoad, stepsFor, stepStatus } from '../../launch/countdown';
import type { LaunchSnapshot } from '../../launch/launchRuntime';
import { formatPercent } from '../format';

const ICON = { done: '✓', active: '▸', pending: '○' } as const;

/** Mission header and the countdown checklist. */
export function CountdownPanel({ snap }: { snap: LaunchSnapshot }) {
  const ctx = snap.context;
  if (!ctx) return null;
  const steps = stepsFor(ctx.crewed);
  const clock =
    snap.phase === 'countdown'
      ? snap.clockS
      : snap.phase === 'ascent' ||
          snap.phase === 'recovery' ||
          snap.phase === 'debrief' ||
          snap.phase === 'handoff'
        ? 1
        : -1e9;
  const load = propellantLoad(snap.phase === 'countdown' ? snap.clockS : clock > 0 ? 0 : -1e9);
  return (
    <div className="panel countdown">
      <div className="eyebrow">Mission</div>
      <div className="location-name">{ctx.outcome.missionName}</div>
      <p className="muted small-text">
        Vehicle "{ctx.outcome.designName}" ·{' '}
        {ctx.crewed ? `Crew: ${ctx.crewNames.join(', ')}` : 'Uncrewed'}
      </p>
      <div className="eyebrow section-gap">
        Countdown {snap.phase === 'countdown' && formatTMinus(snap.clockS)}
      </div>
      <ol className="checklist">
        {steps.map((step, i) => {
          const status = clock > 0 ? 'done' : stepStatus(steps, i, clock);
          return (
            <li
              key={step.id}
              className={status === 'done' ? 'done' : status === 'active' ? 'current' : ''}
              title={step.detail}
            >
              <span className="check" aria-hidden="true">
                {ICON[status]}
              </span>
              <span>
                <span className="muted">{formatTMinus(step.atS)}</span> {step.label}
                <span className="sr-only"> ({status})</span>
              </span>
            </li>
          );
        })}
      </ol>
      {snap.phase === 'countdown' && (
        <div className="section-gap">
          {(['booster', 'ship'] as const).map((k) => (
            <div key={k} className="load-row">
              <span>{k === 'booster' ? 'Booster' : 'Ship'} propellant</span>
              <div
                className="progress"
                role="progressbar"
                aria-label={`${k} propellant load`}
                aria-valuenow={Math.round(load[k] * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="progress-fill" style={{ width: formatPercent(load[k]) }} />
              </div>
              <span className="muted">{formatPercent(load[k])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
