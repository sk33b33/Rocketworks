import { selectMissionReport, useGameStore } from '../../app/gameStore';
import type { MissionTab } from '../../missions/missionReadiness';
import { BriefingTab } from './BriefingTab';
import { ConditionsTab } from './ConditionsTab';
import { ManifestTab } from './ManifestTab';
import { MissionReadinessTab } from './MissionReadinessTab';

const TABS: { id: MissionTab; label: string }[] = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'manifest', label: 'Manifest' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'conditions', label: 'Conditions' },
];

const STATUS = {
  go: { text: '✓ GO', tone: 'ok' },
  'go-with-warnings': { text: '! GO (warnings)', tone: 'warn' },
  'no-go': { text: '✕ NO-GO', tone: 'bad' },
} as const;

export function MissionPanel() {
  const tab = useGameStore((s) => s.missionTab);
  const setTab = useGameStore((s) => s.setMissionTab);
  const report = useGameStore(selectMissionReport);
  const critical = report.issues.filter((i) => i.severity === 'critical').length;
  const status = STATUS[report.status];
  return (
    <div className="panel vehicle mission-panel">
      <div className="design-bar">
        <span className="design-title">{report.mission.name}</span>
        <span className={`cert-badge tone-${status.tone}`}>{status.text}</span>
      </div>
      <div className="tabs" role="tablist" aria-label="Mission planning">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`mtab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="mission-tabpanel"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'readiness' && critical > 0 && (
              <span className="tab-badge tone-bad"> {critical}✕</span>
            )}
            {t.id === 'conditions' && report.conditions.overall !== 'green' && (
              <span
                className={`tab-badge tone-${report.conditions.overall === 'red' ? 'bad' : 'warn'}`}
              >
                {' '}
                !
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        className="tab-body"
        role="tabpanel"
        id="mission-tabpanel"
        aria-labelledby={`mtab-${tab}`}
      >
        {tab === 'briefing' && <BriefingTab />}
        {tab === 'manifest' && <ManifestTab />}
        {tab === 'readiness' && <MissionReadinessTab />}
        {tab === 'conditions' && <ConditionsTab />}
      </div>
    </div>
  );
}
