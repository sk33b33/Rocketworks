import { useGameStore } from '../app/gameStore';

const STEPS = [
  [
    'Rocket Factory',
    'Assemble a two-stage reusable rocket part by part. The guide can do any step for you. Certify it for flight.',
  ],
  [
    'Mission Control',
    'Pick a mission, assign the vehicle, crew and payload, check the go/no-go poll, then commit.',
  ],
  [
    'Launch Pad',
    'Roll out, run the countdown and watch the ascent; the booster comes back for a catch or a platform landing.',
  ],
  [
    'Flight / Orbit',
    'The autopilot can fly every phase: circularize, deorbit, re-entry and the landing burn. Take over any time.',
  ],
  [
    'Orbital Station',
    'Rendezvous, then approach and dock along the corridor; run the docked tasks and come home.',
  ],
  [
    'Moon',
    'Refuel in orbit, fly to the Moon, choose a landing site and land, work on the surface and return.',
  ],
] as const;

/** First-run overview of the program loop (reopen it from Settings). */
export function ProgramOverview() {
  const seen = useGameStore((s) => s.ui.overviewSeen);
  const setSeen = useGameStore((s) => s.setOverviewSeen);
  if (seen) return null;
  return (
    <div className="overview-backdrop">
      <div
        className="panel overview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-title"
      >
        <h2 id="overview-title">Welcome to Rocketworks</h2>
        <p>
          Build a reusable heavy-lift rocket and grow a space program, from the factory floor to the
          Moon. Each location unlocks the next:
        </p>
        <ol className="overview-steps">
          {STEPS.map(([name, text]) => (
            <li key={name}>
              <strong>{name}</strong>: {text}
            </li>
          ))}
        </ol>
        <p className="small-text muted">
          The top bar always shows where you are and what to do next. Press ? in any location for
          its controls; Settings has reduced motion and interface size. Physics is simplified for
          play and is not a flight simulator.
        </p>
        <div className="actions">
          <button type="button" className="primary" autoFocus onClick={() => setSeen(true)}>
            Start in the Factory
          </button>
        </div>
      </div>
    </div>
  );
}
