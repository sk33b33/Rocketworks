import { flightRuntime } from '../../app/flightBinding';
import {
  CREDITABLE_IN_FLIGHT,
  completedOrbits,
  objectiveDone,
  OBJECTIVE_LABELS,
  type ObjectiveId,
} from '../../flight/flightOutcome';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { fmt } from './useFlight';

const ORDER: ObjectiveId[] = ['orbit', 'lap', 'deorbit', 'reentry', 'landing'];

/** Objective checklist plus the next suggested action. */
export function ObjectivesPanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  const ctx = snap.context;
  if (!s || !ctx) return null;
  const p = snap.progress;
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
    case 'deorbit':
      return 'Next: pick a landing zone and engage "Deorbit to target".';
    case 'reentry':
      return 'Next: hold belly-first through peak heating. Re-entry guidance banks to steer range.';
    case 'landing':
      return 'Next: the landing burn flips the ship upright and touches down.';
    default:
      return 'All objectives complete.';
  }
}
