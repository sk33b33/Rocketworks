import { selectGuide, useGameStore } from '../../app/gameStore';
import { formatPercent } from '../format';

/** First-build checklist. Always derived from the blueprint, so it never drifts out of sync. */
export function GuidePanel() {
  const guide = useGameStore(selectGuide);
  const collapsed = useGameStore((s) => s.ui.guideCollapsed);
  const setCollapsed = useGameStore((s) => s.setGuideCollapsed);
  const runStep = useGameStore((s) => s.runGuideStep);
  const selectPart = useGameStore((s) => s.selectCatalogPart);
  const current = guide.currentStep;

  return (
    <div className="panel guide">
      <div className="panel-header">
        <h2>Guided build</h2>
        <span className="muted">
          {guide.requiredDone}/{guide.requiredTotal} · {formatPercent(guide.completeness)}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>
      {current ? (
        <div className="current-step">
          <div className="eyebrow">{current.required ? 'Next step' : 'Optional'}</div>
          <p className="step-title">{current.title}</p>
          <p className="hint">{current.hint}</p>
          <div className="actions">
            {current.partIds[0] && (
              <button
                type="button"
                className="primary"
                onClick={() => selectPart(current.partIds[0]!)}
              >
                Select part
              </button>
            )}
            <button type="button" onClick={() => runStep(current.id)}>
              Do it for me
            </button>
          </div>
        </div>
      ) : (
        <p className="step-title">
          ✓ Starter build complete. Certify it in the Readiness tab, then plan a flight in Mission
          Control.
        </p>
      )}
      {!collapsed && (
        <ol className="checklist">
          {guide.steps.map(({ step, done }) => (
            <li
              key={step.id}
              className={`${done ? 'done' : ''} ${step === current ? 'current' : ''}`}
            >
              <span className="check" aria-hidden="true">
                {done ? '✓' : step === current ? '▸' : '○'}
              </span>
              <span>
                {step.title}
                <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
