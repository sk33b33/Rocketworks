import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import type { MarsCameraMode } from '../../scenes/mars/marsController';
import { useShortcut } from '../useShortcut';
import { AutopilotPanel } from '../flight/AutopilotPanel';
import { FlightControlsBar } from '../flight/FlightControlsBar';
import { FlightDebrief } from '../flight/FlightDebrief';
import { FlightHelp } from '../flight/FlightHelp';
import { ObjectivesPanel } from '../flight/ObjectivesPanel';
import { VehiclePanel } from '../flight/VehiclePanel';
import { useFlightKeys, useFlightSnapshot } from '../flight/useFlight';
import { flownFromMars } from '../../flight/flightRuntime';
import { MarsBasePanel } from './MarsBasePanel';
import { MarsDescentPanel } from './MarsDescentPanel';
import { MarsPanel } from './MarsPanel';
import { MarsReturnPanel } from './MarsReturnPanel';
import { MarsSitePicker } from './MarsSitePicker';
import { MarsSurfacePanel } from './MarsSurfacePanel';

const CAMERAS: { id: MarsCameraMode; label: string; key: string }[] = [
  { id: 'chase', label: 'Chase', key: '1' },
  { id: 'site', label: 'Landing site', key: '2' },
  { id: 'planet', label: 'Mars', key: '3' },
  { id: 'system', label: 'Solar system', key: '4' },
];

/** Mars location overlay: empty state, voyage status, site choice, entry and landing, surface. */
export function MarsHud() {
  const snap = useFlightSnapshot();
  const goTo = useGameStore((s) => s.goTo);
  const camera = useGameStore((s) => s.marsCamera);
  const setCamera = useGameStore((s) => s.setMarsCamera);
  const [help, setHelp] = useState(false);
  const s = snap.state;
  const mars = snap.mars;
  const manual = !!mars?.manualAllowed && snap.phase === 'voyage';
  useFlightKeys(manual && !help);
  useShortcut(['?'], () => setHelp((h) => !h));
  useShortcut(['Escape'], () => setHelp(false), help);

  if (!mars || !s || snap.phase === 'idle') {
    return (
      <div className="factory-hud launch-hud">
        <div className="panel empty-pad" role="status">
          <h2>No ship bound for Mars</h2>
          <p>
            The Mars Cargo Lander unlocks after the Lunar Landing; once its propellant plant is
            running, the crewed Mars Expedition follows. Launch inside an Earth–Mars window, refuel
            in Earth orbit and engage trans-Mars injection: the cruise, the arrival and the landing
            are followed here.
          </p>
          <MarsBasePanel />
          <div className="actions">
            <button type="button" className="primary" onClick={() => goTo('mission-control')}>
              Go to Mission Control
            </button>
            {snap.phase !== 'idle' && (
              <button type="button" onClick={() => goTo('flight')}>
                Go to Flight / Orbit
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const atEarth = !flownFromMars(snap);
  const home = mars.leg === 'home';
  const nearMars = s.origin === 'mars' || !!mars.surface;
  const systemView = !nearMars || camera === 'system';
  const showDescent =
    !home && !!mars.geometry && s.origin === 'mars' && (mars.marsAltitudeM ?? Infinity) < 200_000;
  return (
    <div className="factory-hud launch-hud flight-hud">
      <div className="hud-col hud-left">
        {mars.surface ? (
          <section data-panel="surface">
            <MarsSurfacePanel snap={snap} />
          </section>
        ) : home ? (
          <section data-panel="return">
            <MarsReturnPanel snap={snap} />
          </section>
        ) : showDescent ? (
          <section data-panel="descent">
            <MarsDescentPanel snap={snap} />
          </section>
        ) : (
          <section data-panel="sites">
            <MarsSitePicker mars={mars} />
          </section>
        )}
        <section data-panel="objectives">
          <ObjectivesPanel snap={snap} />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="mars">
          <MarsPanel snap={snap} showGoTo={false} />
        </section>
        {!mars.surface &&
          (atEarth ||
            manual ||
            snap.program.program === 'mars-entry' ||
            (home && s.origin === 'mars')) && (
            <section data-panel="autopilot">
              <AutopilotPanel snap={snap} />
            </section>
          )}
        <section data-panel="ship">
          <VehiclePanel snap={snap} />
        </section>
      </div>
      {atEarth && !home && (
        <div className="flight-message" role="status">
          Still in Earth orbit: refuel, then engage trans-Mars injection (here or at Flight /
          Orbit).
        </div>
      )}
      {atEarth && home && (
        <div className="flight-message" role="status">
          Back at Earth: the aerocapture, deorbit and landing are flown at Flight / Orbit.{' '}
          <button type="button" className="primary" onClick={() => goTo('flight')}>
            Go to Flight / Orbit
          </button>
        </div>
      )}
      {!atEarth && snap.message && (snap.phase === 'voyage' || snap.phase === 'surface') && (
        <div className="flight-message" role="status" aria-live="polite">
          {snap.message}
        </div>
      )}
      {systemView && (
        <p className="map-legend small-text" aria-label="Map legend">
          <span className="legend-sun">● Sun</span> <span className="legend-earth">● Earth</span>{' '}
          <span className="legend-mars">● Mars</span> <span className="legend-ship">● ship</span>{' '}
          <span className="legend-path">— predicted path</span> · not to scale
        </p>
      )}
      {snap.phase === 'debrief' && snap.record && <FlightDebrief record={snap.record} />}
      {help && <FlightHelp onClose={() => setHelp(false)} />}
      <FlightControlsBar
        snap={snap}
        onHelp={() => setHelp(true)}
        cameras={{ options: CAMERAS, current: camera, set: setCamera }}
      />
    </div>
  );
}
