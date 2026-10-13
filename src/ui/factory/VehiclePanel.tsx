import { selectProgram, selectReadiness, useGameStore, type VehicleTab } from '../../app/gameStore';
import { DesignsPanel } from './DesignsPanel';
import { ProgramPanel } from './ProgramPanel';
import { CertificationBadge, ReadinessPanel } from './ReadinessPanel';
import { StatsPanel } from './StatsPanel';

const TABS: { id: VehicleTab; label: string }[] = [
  { id: 'stats', label: 'Stats' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'program', label: 'Program' },
  { id: 'designs', label: 'Designs' },
];

/** Active design summary plus tabbed stats / readiness / program / design library. */
export function VehiclePanel() {
  const tab = useGameStore((s) => s.vehicleTab);
  const setTab = useGameStore((s) => s.setVehicleTab);
  const name = useGameStore((s) => s.blueprint.name);
  const report = useGameStore(selectReadiness);
  const program = useGameStore(selectProgram);
  const badge = report.criticalCount
    ? `${report.criticalCount}✕`
    : report.warningCount
      ? `${report.warningCount}!`
      : '✓';

  return (
    <div className="panel vehicle">
      <div className="design-bar">
        <button
          type="button"
          className="design-title"
          onClick={() => setTab('designs')}
          title="Open the design library"
        >
          {name}
        </button>
        <CertificationBadge />
        <span className="muted rp" title="Research points available">
          {program.researchAvailable} RP
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Vehicle information">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`vtab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="vehicle-tabpanel"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'readiness' && (
              <span
                className={`tab-badge tone-${report.criticalCount ? 'bad' : report.warningCount ? 'warn' : 'ok'}`}
              >
                {' '}
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        className="tab-body"
        role="tabpanel"
        id="vehicle-tabpanel"
        aria-labelledby={`vtab-${tab}`}
      >
        {tab === 'stats' && <StatsPanel />}
        {tab === 'readiness' && <ReadinessPanel />}
        {tab === 'program' && <ProgramPanel />}
        {tab === 'designs' && <DesignsPanel />}
      </div>
    </div>
  );
}
