import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { formatCredits } from '../format';

const RISK_TONE = { low: 'ok', moderate: 'warn', high: 'bad' } as const;

export function BriefingTab() {
  const report = useGameStore(selectMissionReport);
  const m = report.mission;
  return (
    <div className="briefing">
      <p className="lead">{m.summary}</p>
      <p>{m.briefing}</p>
      <div className="eyebrow section-gap">Objectives</div>
      <ol className="plain-list">
        {m.objectives.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ol>
      <div className="eyebrow section-gap">Abort criteria</div>
      <ul className="plain-list">
        {m.abortCriteria.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <div className="row section-gap">
        <span className="eyebrow">Estimated risk</span>
        <strong className={`tone-${RISK_TONE[report.risk.level]}`}>
          {report.risk.level.toUpperCase()} ({Math.round(report.risk.score * 100)}%)
        </strong>
      </div>
      {report.risk.factors.length > 0 && (
        <ul className="plain-list muted">
          {report.risk.factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <div className="row section-gap">
        <span className="eyebrow">Reward (first success)</span>
        <strong>
          +{m.rewardRp} RP · +{formatCredits(m.rewardCredits)} budget
        </strong>
      </div>
      <p className="footnote">
        Risk and requirements are simplified game estimates, not mission-assurance figures.
      </p>
    </div>
  );
}
