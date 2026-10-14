import { flightRuntime } from '../../app/flightBinding';
import {
  CREDITABLE_IN_FLIGHT,
  completedOrbits,
  objectiveDone,
  objectivesFor,
  OBJECTIVE_LABELS,
  type ObjectiveId,
} from '../../flight/flightOutcome';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { fmt } from './useFlight';

/** Objective checklist plus the next suggested action. */
export function ObjectivesPanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  const ctx = snap.context;
  if (!s || !ctx) return null;
  const p = snap.progress;
  const refuel = ctx.mars ? { leo: ctx.mars.refuelLeo, depot: false } : (ctx.lunar?.refuel ?? null);
  const ORDER: ObjectiveId[] = objectivesFor(ctx.outcome.missionId, refuel);
  const next = ORDER.find((id) => !objectiveDone(id, p, s));
  const lapPct = p.orbit ? Math.min(1, p.travelSinceOrbit / (2 * Math.PI)) : 0;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Objectives</h2>
        <span className="muted">{ctx.outcome.missionName}</span>
      </div>
      <ol className="checklist">
        {ORDER.map((id) => {
          const done = objectiveDone(id, p, s);
          return (
            <li key={id} className={done ? 'done' : id === next ? 'current' : ''}>
              <span className="check" aria-hidden="true">
                {done ? '✓' : id === next ? '▶' : '○'}
              </span>
              <span>
                {OBJECTIVE_LABELS[id]}
                {id === 'lap' && p.orbit && !done && ` (${fmt(lapPct * 100)}%)`}
                <span className="sr-only">{done ? ' (done)' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {completedOrbits(p) > 1 && (
        <p className="small-text muted">{completedOrbits(p)} orbits flown.</p>
      )}
      {!CREDITABLE_IN_FLIGHT.has(ctx.outcome.missionId) && (
        <p className="small-text tone-warn">
          This mission&apos;s station or lunar objectives arrive in later stages; a safe return
          records a partial result.
        </p>
      )}
      <p className="hint">{nextAction(next, !!ctx.mars)}</p>
    </div>
  );
}

function nextAction(next: ObjectiveId | undefined, mars: boolean): string {
  switch (next) {
    case 'tmi':
      return 'Next: engage "Trans-Mars injection". It plans the burn for today\'s window and sends the ship on its way.';
    case 'mars-arrival':
      return 'Next: cruise to Mars at the Mars location. Warp up to 1,000,000×; course corrections are automatic. Choose a landing site on the way.';
    case 'mars-landing':
      return 'Next: entry guidance flies the entry and the landing burn. Take over below 500 m for a manual landing.';
    case 'mars-surface':
      return 'Next: lower the propellant plant and start it (time warp up to 10,000× on the surface), then complete the mission.';
    case 'mars-crew-tasks':
      return 'Next: the crew works through the surface tasks at the Mars location (time warp up to 10,000×).';
    case 'mars-refuel':
      return 'Next: once the propellant line is connected, press "Refuel from the plant". "Wait for the window" skips ahead to the return window while it pumps.';
    case 'mars-ascent':
      return 'Next: "Lift off" from the surface panel. The ascent program climbs to a 200 km Mars orbit.';
    case 'tei':
      return 'Next: inside the return window, engage "Trans-Earth injection" from Mars orbit (warp up to 100,000× while you wait).';
    case 'mars-return':
      return 'Next: cruise home (up to 1,000,000×). Course corrections aim the ship at the aerocapture corridor; the arrival is flown at Flight / Orbit.';
    case 'orbit':
      return 'Next: raise periapsis with the Circularize program (or burn prograde near apoapsis).';
    case 'lap':
      return 'Next: coast around the Earth. Use time warp (up to 1000× above 110 km).';
    case 'rendezvous':
      return 'Next: engage "Rendezvous with station". It waits for the transfer window (warp is fine), then closes to a hold point 2 km ahead of the station.';
    case 'dock':
      return 'Next: begin proximity operations and dock at the forward port (assist available).';
    case 'tasks':
      return 'Next: finish the docked tasks, undock, back out beyond 300 m and depart.';
    case 'refuel':
      return `Next: switch the autopilot off and call the tankers ("Refuel in orbit" in the ${mars ? 'Mars' : 'Moon'} panel). Warp through the six hours.`;
    case 'tli':
      return 'Next: engage "Trans-lunar injection". It plans the burn from your parking orbit, then corrects course on the way.';
    case 'flyby':
      return 'Next: coast to the Moon. Deep-space warp goes up to 10,000×; the autopilot handles course corrections.';
    case 'lunar-orbit':
      return 'Next: lunar orbit insertion engages automatically near the Moon (or engage it yourself).';
    case 'depot':
      return 'Next: top up at the lunar depot (Moon panel), then choose a landing site at the Moon location.';
    case 'moon-landing':
      return 'Next: at the Moon location, pick a site and engage "Lunar landing". Take over below 500 m for a manual landing.';
    case 'surface':
      return 'Next: run the surface tasks (time warp is available).';
    case 'moon-ascent':
      return 'Next: lift off back to lunar orbit.';
    case 'earth-return':
      return 'Next: engage "Return to Earth". The ship aerocaptures into Earth orbit on arrival.';
    case 'deorbit':
      return 'Next: pick a landing zone and engage "Deorbit to target".';
    case 'reentry':
      return 'Next: hold belly-first through peak heating. Re-entry guidance banks to steer range.';
    case 'landing':
      return 'Next: the landing burn flips the ship upright and touches down. For a bonus, switch the autopilot off and fly everything below 5 km yourself.';
    default:
      return 'All objectives complete.';
  }
}
