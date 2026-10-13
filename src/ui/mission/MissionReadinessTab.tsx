import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { POLL_LABELS } from '../../missions/missionReadiness';
import { formatSpeed } from '../format';

const POLL_TEXT = { go: '✓ GO', hold: '! HOLD', 'no-go': '✕ NO-GO' } as const;
const POLL_TONE = { go: 'ok', hold: 'warn', 'no-go': 'bad' } as const;

/** The flight director's poll plus actionable mission issues. */
export function MissionReadinessTab() {
  const report = useGameStore(selectMissionReport);
  const runFix = useGameStore((s) => s.runMissionFix);
  const dv = report.deltaV?.totalMs ?? 0;
  const share = Math.min(1, dv / report.requiredDeltaVMs);
  return (
    <div className="mission-readiness">
      <ul className="poll">
        {report.poll.map((p) => (
          <li key={p.area}>
            <span>{POLL_LABELS[p.area]}</span>
            <strong className={`tone-${POLL_TONE[p.status]}`}>{POLL_TEXT[p.status]}</strong>
          </li>
        ))}
      </ul>
      <div className="dv section-gap">
        <div className="row">
          <span>Mission Δv (with payload + crew)</span>
          <strong className={share >= 1 ? 'tone-ok' : 'tone-bad'}>
            {formatSpeed(dv)} / {formatSpeed(report.requiredDeltaVMs)}
          </strong>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Mission delta-v versus requirement"
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`progress-fill ${share >= 1 ? '' : 'fill-bad'}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      </div>
      {report.issues.length === 0 ? (
        <p className="tone-ok section-gap">✓ All stations report GO.</p>
      ) : (
        <ul className="issues">
          {report.issues.map((issue) => (
            <li key={issue.id} className={`issue issue-${issue.severity}`}>
              <div className="issue-title">
                <span aria-hidden="true">{issue.severity === 'critical' ? '✕' : '!'}</span>
                <span className="sr-only">{issue.severity}: </span>
                {issue.title}
              </div>
              <p>{issue.detail}</p>
              <p className="fix">
                <strong>Fix:</strong> {issue.fix}
              </p>
              {issue.action && (
                <button type="button" onClick={() => runFix(issue.action!)}>
                  {issue.actionLabel ?? 'Fix'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
