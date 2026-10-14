import { useState, useSyncExternalStore } from 'react';
import { useGameStore } from '../../app/gameStore';
import { continueToOrbit, handoffPending } from '../../app/flightBinding';
import { launchRuntime } from '../../app/launchBinding';
import { useShortcut } from '../useShortcut';
import { AutopilotPanel } from './AutopilotPanel';
import { FlightControlsBar } from './FlightControlsBar';
import { FlightDebrief } from './FlightDebrief';
import { FlightHelp } from './FlightHelp';
import { ObjectivesPanel } from './ObjectivesPanel';
import { OrbitPanel } from './OrbitPanel';
import { VehiclePanel } from './VehiclePanel';
import { StationPanel } from './StationPanel';
import { useFlightKeys, useFlightSnapshot } from './useFlight';

/** Flight / Orbit overlay: empty state, orbit and ship telemetry, autopilot, controls, debrief. */
export function FlightHud() {
  const snap = useFlightSnapshot();
  // Re-render when the launch hands off (the empty state offers to continue).
  useSyncExternalStore(launchRuntime.subscribe, launchRuntime.getSnapshot);
  const goTo = useGameStore((s) => s.goTo);
  const [help, setHelp] = useState(false);
  const flying = snap.phase === 'flight' && snap.state?.phase === 'flight';
  useFlightKeys(flying && !help);
  useShortcut(['?'], () => setHelp((h) => !h));
  useShortcut(['Escape'], () => setHelp(false), help);

  if (snap.phase === 'idle' || !snap.state) {
    const pending = handoffPending();
    return (
      <div className="factory-hud launch-hud">
        <div className="panel empty-pad" role="status">
          <h2>{pending ? 'Ship in orbit' : 'No ship in flight'}</h2>
          <p>
            {pending
              ? 'The ship has reached orbit and is waiting for you to take over.'
              : 'Launch an orbital mission from the Launch Pad. After orbit insertion the flight continues here.'}
          </p>
          <div className="actions">
            {pending ? (
              <button type="button" className="primary" onClick={() => continueToOrbit()}>
                Take control in orbit
              </button>
            ) : (
              <>
                <button type="button" className="primary" onClick={() => goTo('mission-control')}>
                  Go to Mission Control
                </button>
                <button type="button" onClick={() => goTo('launch-pad')}>
                  Go to the Launch Pad
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="factory-hud launch-hud flight-hud">
      <div className="hud-col hud-left">
        <section data-panel="orbit">
          <OrbitPanel snap={snap} />
        </section>
        <section data-panel="objectives">
          <ObjectivesPanel snap={snap} />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="autopilot">
          <AutopilotPanel snap={snap} />
        </section>
        {snap.station && snap.phase === 'flight' && (
          <section data-panel="station">
            <StationPanel snap={snap} />
          </section>
        )}
        <section data-panel="ship">
          <VehiclePanel snap={snap} />
        </section>
      </div>
      {snap.message && snap.phase === 'flight' && (
        <div className="flight-message" role="status" aria-live="polite">
          {snap.message}
        </div>
      )}
      {snap.phase === 'debrief' && snap.record && <FlightDebrief record={snap.record} />}
      {snap.phase === 'proximity' && (
        <div className="panel debrief" role="dialog" aria-label="At the station">
          <h2 className="debrief-title">The ship is at the station</h2>
          <p>Proximity operations are in progress at the Orbital Station location.</p>
          <div className="actions">
            <button type="button" className="primary" autoFocus onClick={() => goTo('station')}>
              Go to the Orbital Station
            </button>
          </div>
        </div>
      )}
      {help && <FlightHelp onClose={() => setHelp(false)} />}
      <FlightControlsBar snap={snap} onHelp={() => setHelp(true)} />
    </div>
  );
}
