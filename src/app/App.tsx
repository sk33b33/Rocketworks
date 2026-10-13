import { ErrorBoundary } from '../ui/ErrorBoundary';
import { LocationSelector } from '../ui/LocationSelector';
import { NoticeBar } from '../ui/NoticeBar';
import { ObjectivePanel } from '../ui/ObjectivePanel';
import { Viewport } from '../ui/Viewport';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ROCKETWORKS</span>
        <LocationSelector />
      </header>
      <main className="stage">
        <ErrorBoundary>
          <Viewport />
        </ErrorBoundary>
        <ObjectivePanel />
        <NoticeBar />
      </main>
    </div>
  );
}
