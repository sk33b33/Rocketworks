import { ErrorBoundary } from '../ui/ErrorBoundary';
import { FactoryHud } from '../ui/factory/FactoryHud';
import { MissionControlHud } from '../ui/mission/MissionControlHud';
import { LaunchPadHud } from '../ui/launch/LaunchPadHud';
import { FlightHud } from '../ui/flight/FlightHud';
import { StationHud } from '../ui/station/StationHud';
import { MoonHud } from '../ui/moon/MoonHud';
import { MarsHud } from '../ui/mars/MarsHud';
import { LocationSelector } from '../ui/LocationSelector';
import { SettingsMenu } from '../ui/SettingsMenu';
import { NextStepChip } from '../ui/NextStepChip';
import { ProgramOverview } from '../ui/ProgramOverview';
import { PerfOverlay } from '../ui/PerfOverlay';
import { NoticeBar } from '../ui/NoticeBar';
import { Viewport } from '../ui/Viewport';
import { useGameStore } from './gameStore';

export function App() {
  const location = useGameStore((s) => s.currentLocation);
  const showPerf = useGameStore((s) => s.showPerf);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ROCKETWORKS</span>
        <LocationSelector />
        <NextStepChip />
        <SettingsMenu />
      </header>
      <main className="stage">
        <ErrorBoundary>
          <Viewport />
          {location === 'factory' && <FactoryHud />}
          {location === 'mission-control' && <MissionControlHud />}
          {location === 'launch-pad' && <LaunchPadHud />}
          {location === 'flight' && <FlightHud />}
          {location === 'station' && <StationHud />}
          {location === 'moon' && <MoonHud />}
          {location === 'mars' && <MarsHud />}
        </ErrorBoundary>
        <NoticeBar />
        <ProgramOverview />
        {showPerf && <PerfOverlay />}
      </main>
    </div>
  );
}
