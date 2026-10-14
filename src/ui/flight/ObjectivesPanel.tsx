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
  const ORDER: ObjectiveId[] = objectivesFor(ctx.outcome.missionId, ctx.lunar?.refuel ?? null);
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
      <p className="hint">{nextAction(next)}</p>
    </div>
  );
}

function nextAction(next: ObjectiveId | undefined): string {
  switch (next) {
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
      return 'Next: switch the autopilot off and call the tankers ("Refuel in orbit" in the Moon panel). Warp through the six hours.';
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
