import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { CameraToolbar } from './CameraToolbar';
import { CatalogPanel } from './CatalogPanel';
import { GuidePanel } from './GuidePanel';
import { InspectorPanel } from './InspectorPanel';
import { StatsPanel } from './StatsPanel';

type Tab = 'guide' | 'parts' | 'selected' | 'stats';
const TABS: { id: Tab; label: string }[] = [
  { id: 'guide', label: 'Guide' },
  { id: 'parts', label: 'Parts' },
  { id: 'selected', label: 'Selected' },
  { id: 'stats', label: 'Stats' },
];

/**
 * Factory overlay. Desktop: guide + catalog on the left, stats + inspector on the right.
 * Narrow screens: one panel at a time in a bottom sheet chosen by tabs.
 */
export function FactoryHud() {
  const [tab, setTab] = useState<Tab>('guide');
  const selection = useGameStore((s) => s.selection);
  const [lastSelection, setLastSelection] = useState(selection);
  if (selection !== lastSelection) {
    setLastSelection(selection);
    if (selection?.kind === 'instance') setTab('selected');
  }

  return (
    <div className="factory-hud" data-tab={tab}>
      <div className="hud-col hud-left">
        <section data-panel="guide">
          <GuidePanel />
        </section>
        <section data-panel="parts" className="grow">
          <CatalogPanel />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="selected">
          <InspectorPanel />
        </section>
        <section data-panel="stats">
          <StatsPanel />
        </section>
      </div>
      <nav className="hud-tabs" aria-label="Factory panels">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <CameraToolbar />
    </div>
  );
}
