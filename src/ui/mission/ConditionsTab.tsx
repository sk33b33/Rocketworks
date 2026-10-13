import { selectMissionReport, useGameStore } from '../../app/gameStore';

const TEXT = { green: '✓ GO', amber: '! MARGINAL', red: '✕ NO-GO' } as const;
const TONE = { green: 'ok', amber: 'warn', red: 'bad' } as const;

/** Launch window and weather (game modifiers), with a free "wait" option. */
export function ConditionsTab() {
  const report = useGameStore(selectMissionReport);
  const waits = useGameStore((s) => s.mission.waits);
  const wait = useGameStore((s) => s.waitForWindow);
  const c = report.conditions;
  return (
    <div className="conditions">
      <div className={`status-banner tone-${TONE[c.overall]}`} role="status">
        Weather {TEXT[c.overall]} · window opens T-{c.windowOpensInHours} h, lasts {c.windowMinutes}{' '}
        min
      </div>
      <table className="cond-table">
        <thead>
          <tr>
            <th scope="col">Factor</th>
            <th scope="col">Now</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {c.factors.map((f) => (
            <tr key={f.id} title={f.note}>
              <th scope="row">
                {f.label}
                <div className="muted small">{f.limit}</div>
              </th>
              <td>{f.value}</td>
              <td className={`tone-${TONE[f.status]}`}>{TEXT[f.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        <button type="button" onClick={wait}>
          Wait for next window
        </button>
        <span className="muted">
          {waits ? `Waited ${waits} window${waits > 1 ? 's' : ''}` : 'Waiting is free'}
        </span>
      </div>
      <p className="footnote">
        Generated conditions for gameplay, inspired by launch-commit criteria. Red items block
        commitment; amber items raise mission risk.
      </p>
    </div>
  );
}
