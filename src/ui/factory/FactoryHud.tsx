import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { BuildPanel } from './BuildPanel';
import { CameraToolbar } from './CameraToolbar';
import { GuidePanel } from './GuidePanel';
import { InspectorPanel } from './InspectorPanel';
import { VehiclePanel } from './VehiclePanel';

type Tab = 'guide' | 'build' | 'selected' | 'vehicle';
const TABS: { id: Tab; label: string }[] = [
  { id: 'guide', label: 'Guide' },
  { id: 'build', label: 'Build' },
  { id: 'selected', label: 'Selected' },
  { id: 'vehicle', label: 'Vehicle' },
];

/**
 * Factory overlay. Desktop: guide + build panel on the left, inspector + vehicle panel on the right.
 * Narrow screens: one panel at a time in a bottom sheet chosen by tabs.
 */
export function FactoryHud() {
  const [tab, setTab] = useState<Tab>('guide');
  const selection = useGameStore((s) => s.selection);
  const vehicleTab = useGameStore((s) => s.vehicleTab);
  const [last, setLast] = useState({ selection, vehicleTab });
  if (selection !== last.selection || vehicleTab !== last.vehicleTab) {
    setLast({ selection, vehicleTab });
    if (selection !== last.selection && selection?.kind === 'instance') setTab('selected');
    else if (vehicleTab !== last.vehicleTab) setTab('vehicle');
  }

  return (
    <div className="factory-hud" data-tab={tab}>
      <div className="hud-col hud-left">
        <section data-panel="guide">
          <GuidePanel />
        </section>
        <section data-panel="build" className="grow">
          <BuildPanel />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="selected">
          <InspectorPanel />
        </section>
        <section data-panel="vehicle" className="grow">
          <VehiclePanel />
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
