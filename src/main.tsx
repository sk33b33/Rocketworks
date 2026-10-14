import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/global.css';
import { initFlightAutosave } from './app/flightAutosave';
import { perfProbe } from './game/PerfStats';

initFlightAutosave();
// Read-only hook for automated performance checks.
(window as unknown as { __rocketworksPerf: () => unknown }).__rocketworksPerf = () =>
  perfProbe.stats?.current ?? null;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
