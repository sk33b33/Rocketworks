import { create } from 'zustand';
import { createInitialState, navigate, type GameState } from './gameState';
import type { LocationId } from './locations';

interface GameStore extends GameState {
  /** Latest player-facing warning (e.g. a rejected navigation); null when none. */
  notice: string | null;
  goTo: (target: LocationId) => boolean;
  dismissNotice: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialState(),
  notice: null,
  goTo: (target) => {
    const { saveVersion, currentLocation } = get();
    const result = navigate({ saveVersion, currentLocation }, target);
    if (!result.ok) {
      set({ notice: result.reason });
      return false;
    }
    set({ currentLocation: result.state.currentLocation, notice: null });
    return true;
  },
  dismissNotice: () => set({ notice: null }),
}));
