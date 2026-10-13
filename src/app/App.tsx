import { ErrorBoundary } from '../ui/ErrorBoundary';
import { FactoryHud } from '../ui/factory/FactoryHud';
import { MissionControlHud } from '../ui/mission/MissionControlHud';
import { LaunchPadHud } from '../ui/launch/LaunchPadHud';
import { LocationSelector } from '../ui/LocationSelector';
import { NoticeBar } from '../ui/NoticeBar';
import { Viewport } from '../ui/Viewport';
import { useGameStore } from './gameStore';

export function App() {
  const location = useGameStore((s) => s.currentLocation);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ROCKETWORKS</span>
        <LocationSelector />
      </header>
      <main className="stage">
        <ErrorBoundary>
          <Viewport />
          {location === 'factory' && <FactoryHud />}
          {location === 'mission-control' && <MissionControlHud />}
          {location === 'launch-pad' && <LaunchPadHud />}
        </ErrorBoundary>
        <NoticeBar />
      </main>
    </div>
  );
}
