import { useSyncExternalStore } from 'react';
import { flownFromMars } from '../flight/flightRuntime';
import { useGameStore } from '../app/gameStore';
import { flightRuntime } from '../app/flightBinding';
import { launchRuntime } from '../app/launchBinding';
import { getLocation } from '../app/locations';
import { nextStep } from '../progression/nextStep';

/** Top-bar hint: the next suggested action and where to do it. */
export function NextStepChip() {
  const flight = useSyncExternalStore(flightRuntime.subscribe, flightRuntime.getSnapshot);
  const launch = useSyncExternalStore(launchRuntime.subscribe, launchRuntime.getSnapshot);
  const blueprints = useGameStore((s) => s.blueprints);
  const completed = useGameStore((s) => s.progression.completedMissions);
  const committed = useGameStore((s) => !!s.mission.commit);
  const current = useGameStore((s) => s.currentLocation);
  const goTo = useGameStore((s) => s.goTo);
  const flightAt = flownFromMars(flight)
    ? 'mars'
    : flight.phase === 'proximity'
      ? 'station'
      : flight.phase === 'surface' || (flight.phase === 'flight' && flight.state?.ref === 'moon')
        ? 'moon'
        : flight.phase === 'flight'
          ? 'flight'
          : null;
  const step = nextStep({
    blueprints,
    completedMissionIds: completed,
    missionCommitted: committed,
    flightAt,
    launchActive: launch.phase !== 'idle' && launch.phase !== 'debrief',
  });
  const here = step.location === current;
  return (
    <button
      type="button"
      className={`next-step ${here ? 'here' : ''}`}
      onClick={() => goTo(step.location)}
      title={here ? 'You are here' : `Go to ${getLocation(step.location).name}`}
    >
      <span className="eyebrow">Next</span> {step.text}
      {!here && <span className="muted"> → {getLocation(step.location).name}</span>}
    </button>
  );
}
