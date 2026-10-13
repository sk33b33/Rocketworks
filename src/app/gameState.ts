import { DEFAULT_LOCATION, getAvailability, type LocationId } from './locations';

/** Serializable domain state. Later stages add blueprint, mission, progression, etc. */
export interface GameState {
  readonly saveVersion: 1;
  readonly currentLocation: LocationId;
}

export function createInitialState(): GameState {
  return { saveVersion: 1, currentLocation: DEFAULT_LOCATION };
}

export type NavigationResult =
  { ok: true; state: GameState } | { ok: false; state: GameState; reason: string };

/** Pure navigation reducer: rejects locked locations with a player-readable reason. */
export function navigate(state: GameState, target: LocationId): NavigationResult {
  const availability = getAvailability(target);
  if (!availability.available) return { ok: false, state, reason: availability.reason };
  if (target === state.currentLocation) return { ok: true, state };
  return { ok: true, state: { ...state, currentLocation: target } };
}

export interface Objective {
  readonly title: string;
  readonly nextAction: string;
  /** 0..1 progress through the current stage's goals. */
  readonly progress: number;
}

export function getObjective(state: GameState): Objective {
  switch (state.currentLocation) {
    case 'factory':
      return {
        title: 'Foundation ready: the Rocket Factory is online.',
        nextAction: 'Stage 1 will add the modular rocket assembly. Other locations unlock later.',
        progress: 0,
      };
    default:
      return { title: 'Unavailable', nextAction: 'Return to the Rocket Factory.', progress: 0 };
  }
}
