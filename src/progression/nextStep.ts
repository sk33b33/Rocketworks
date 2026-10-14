import type { LocationId } from '../app/locations';
import { missionAvailability, MISSIONS } from '../missions/missionCatalog';
import type { RocketBlueprint } from '../rocket/model/types';
import { certificationStatus } from '../rocket/readiness/certification';

/*
 * "What's next": one suggested action derived from the program's state, shown in the top bar so
 * the player always knows where to go. Pure.
 */

export interface NextStep {
  readonly text: string;
  readonly location: LocationId;
}

export interface NextStepInput {
  readonly blueprints: readonly RocketBlueprint[];
  readonly completedMissionIds: readonly string[];
  readonly missionCommitted: boolean;
  /** Where an in-progress flight is (null if none). */
  readonly flightAt: LocationId | null;
  /** The launch pad is busy (rollout, countdown, ascent or the hand-off). */
  readonly launchActive: boolean;
}

export function nextStep(i: NextStepInput): NextStep {
  if (i.flightAt) return { text: 'Your flight is in progress', location: i.flightAt };
  if (i.launchActive) return { text: 'Launch in progress', location: 'launch-pad' };
  const certified = i.blueprints.some((b) => {
    const c = certificationStatus(b);
    return c === 'valid' || c === 'override';
  });
  if (!certified) return { text: 'Build and certify a rocket in the Factory', location: 'factory' };
  if (i.missionCommitted) return { text: 'Roll out the committed mission', location: 'launch-pad' };
  const next = MISSIONS.find(
    (m) =>
      !i.completedMissionIds.includes(m.id) &&
      missionAvailability(m, i.completedMissionIds).available,
  );
  if (next) return { text: `Next mission: ${next.name}`, location: 'mission-control' };
  return {
    text: 'Every mission flown: try harder landing sites or fly manually for ratings',
    location: 'mission-control',
  };
}
