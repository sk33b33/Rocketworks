import { useState } from 'react';
import { CommitBar } from './CommitBar';
import { MissionListPanel } from './MissionListPanel';
import { MissionPanel } from './MissionPanel';

type Tab = 'missions' | 'plan';

/** Mission Control overlay. Desktop: mission list left, planning tabs right; mobile: tabbed sheet. */
export function MissionControlHud() {
  const [tab, setTab] = useState<Tab>('plan');
  return (
    <div className="factory-hud mission-hud" data-tab={tab}>
      <div className="hud-col hud-left">
        <section data-panel="missions" className="grow">
          <MissionListPanel />
        </section>
      </div>
      <div className="hud-col hud-right wide">
        <section data-panel="plan" className="grow">
          <MissionPanel />
        </section>
      </div>
      <nav className="hud-tabs two" aria-label="Mission Control panels">
        <button type="button" aria-pressed={tab === 'missions'} onClick={() => setTab('missions')}>
          Missions
        </button>
        <button type="button" aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}>
          Plan
        </button>
      </nav>
      <CommitBar />
    </div>
  );
}
