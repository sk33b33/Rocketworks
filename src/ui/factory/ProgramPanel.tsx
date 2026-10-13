import { selectProgram, useGameStore } from '../../app/gameStore';
import { MILESTONES } from '../../progression/milestones';
import { canResearch, TECH_TREE } from '../../progression/research';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { formatCredits } from '../format';

/** Budget, research points, research projects and milestones. */
export function ProgramPanel() {
  const progression = useGameStore((s) => s.progression);
  const blueprint = useGameStore((s) => s.blueprint);
  const research = useGameStore((s) => s.research);
  const program = useGameStore(selectProgram);
  const cost = calculateRocketStats(blueprint).costCredits;
  const share = Math.min(1, cost / program.budgetCredits);

  return (
    <div className="program">
      <div className="row">
        <span>Design cost / budget</span>
        <strong className={cost > program.budgetCredits ? 'tone-bad' : ''}>
          {formatCredits(cost)} / {formatCredits(program.budgetCredits)}
        </strong>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Budget used"
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`progress-fill ${cost > program.budgetCredits ? 'fill-bad' : ''}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="footnote">
        The budget caps what one design may cost. It grows with milestones and research; nothing is
        spent or refunded.
      </p>

      <div className="row section-gap">
        <span className="eyebrow">Research</span>
        <strong>
          {program.researchAvailable} RP available{' '}
          <span className="muted">({program.researchEarned} earned)</span>
        </strong>
      </div>
      <ul className="tech-list">
        {TECH_TREE.map((t) => {
          const owned = progression.tech.includes(t.id);
          const check = canResearch(progression, t.id);
          return (
            <li key={t.id} className={owned ? 'owned' : ''}>
              <div className="tech-head">
                <strong>
                  {owned ? '✓ ' : ''}
                  {t.name}
                </strong>
                <span className="muted">{t.costRp} RP</span>
              </div>
              <p>{t.description}</p>
              {!owned && (
                <button
                  type="button"
                  onClick={() => research(t.id)}
                  disabled={!check.ok}
                  title={check.ok ? undefined : check.reason}
                >
                  Research
                </button>
              )}
              {!owned && !check.ok && <p className="hint">{check.reason}</p>}
            </li>
          );
        })}
      </ul>

      <div className="eyebrow section-gap">Milestones</div>
      <ul className="checklist milestones">
        {MILESTONES.map((m) => {
          const done = progression.milestones.includes(m.id);
          return (
            <li key={m.id} className={done ? 'done' : ''}>
              <span className="check" aria-hidden="true">
                {done ? '✓' : '○'}
              </span>
              <span>
                <strong>{m.title}</strong> · {m.description}{' '}
                <span className="muted">
                  (+{m.rewardRp} RP{m.rewardCredits ? `, +${formatCredits(m.rewardCredits)}` : ''})
                </span>
                <span className="sr-only">{done ? ' (achieved)' : ' (not yet)'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
