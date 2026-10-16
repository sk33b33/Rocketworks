import { EvaPanel } from '../surface/EvaPanel';
import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import type { MoonCameraMode } from '../../scenes/moon/moonController';
import { useShortcut } from '../useShortcut';
import { AutopilotPanel } from '../flight/AutopilotPanel';
import { FlightControlsBar } from '../flight/FlightControlsBar';
import { FlightDebrief } from '../flight/FlightDebrief';
import { FlightHelp } from '../flight/FlightHelp';
import { ObjectivesPanel } from '../flight/ObjectivesPanel';
import { VehiclePanel } from '../flight/VehiclePanel';
import { useFlightKeys, useFlightSnapshot } from '../flight/useFlight';
import { DescentPanel } from './DescentPanel';
import { LunarPanel } from './LunarPanel';
import { SitePicker } from './SitePicker';
import { SurfacePanel } from './SurfacePanel';

const CAMERAS: { id: MoonCameraMode; label: string; key: string }[] = [
  { id: 'chase', label: 'Chase', key: '1' },
  { id: 'landing', label: 'Landing site', key: '2' },
  { id: 'orbit', label: 'Moon', key: '3' },
];

/** Moon location overlay: empty state, lunar telemetry, site choice, descent, surface and controls. */
export function MoonHud() {
  const snap = useFlightSnapshot();
  const goTo = useGameStore((s) => s.goTo);
  const camera = useGameStore((s) => s.moonCamera);
  const setCamera = useGameStore((s) => s.setMoonCamera);
  const [help, setHelp] = useState(false);
  const s = snap.state;
  const lunar = snap.lunar;
  const flying = snap.phase === 'flight' && s?.phase === 'flight';
  useFlightKeys(flying && !help);
  useShortcut(['?'], () => setHelp((h) => !h));
  useShortcut(['Escape'], () => setHelp(false), help);

  if (!lunar || !s || snap.phase === 'idle') {
    return (
      <div className="factory-hud launch-hud">
        <div className="panel empty-pad" role="status">
          <h2>No ship at the Moon</h2>
          <p>
            Fly the Lunar Flyby (unlocked by the station mission) or the Lunar Landing from Mission
            Control. Refuel in Earth orbit, engage trans-lunar injection, and the ship arrives here
            about three days later.
          </p>
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

  const nearMoon = s.ref === 'moon' || !!lunar.surface;
  const showSites = lunar.plan.landing && !lunar.surface;
  return (
    <div className="factory-hud launch-hud flight-hud">
      <div className="hud-col hud-left">
        {lunar.surface ? (
          <section data-panel="surface">
            <SurfacePanel snap={snap} />
          </section>
        ) : lunar.geometry &&
          lunar.landing?.kind === 'descent' &&
          lunar.landing.descent !== 'deorbit-wait' ? (
          <section data-panel="descent">
            <DescentPanel snap={snap} />
          </section>
        ) : (
          showSites && (
            <section data-panel="sites">
              <SitePicker lunar={lunar} />
            </section>
          )
        )}
        <section data-panel="objectives">
          <ObjectivesPanel snap={snap} />
        </section>
      </div>
      <div className="hud-col hud-right">
        {snap.phase === 'surface' && snap.context?.crewed && (
          <section data-panel="eva">
            <EvaPanel snap={snap} />
          </section>
        )}
        <section data-panel="moon">
          <LunarPanel snap={snap} showGoTo={false} />
        </section>
        {!lunar.surface && (
          <section data-panel="autopilot">
            <AutopilotPanel snap={snap} />
          </section>
        )}
        <section data-panel="ship">
          <VehiclePanel snap={snap} />
        </section>
      </div>
      {!nearMoon && snap.phase === 'flight' && (
        <div className="flight-message" role="status">
          The ship is {Math.round(lunar.moonAltitudeM / 1000).toLocaleString('en-US')} km from the
          Moon. Follow it here, or fly from Flight / Orbit.
        </div>
      )}
      {snap.message && nearMoon && (snap.phase === 'flight' || snap.phase === 'surface') && (
        <div className="flight-message" role="status" aria-live="polite">
          {snap.message}
        </div>
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
