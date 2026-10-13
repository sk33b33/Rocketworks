import { describe, expect, it } from 'vitest';
import { createInitialState, getObjective, navigate } from '../src/app/gameState';
import { useGameStore } from '../src/app/gameStore';

describe('navigate', () => {
  it('starts in the factory', () => {
    expect(createInitialState().currentLocation).toBe('factory');
  });

  it('rejects locked locations with a reason and keeps state', () => {
    const state = createInitialState();
    const result = navigate(state, 'launch-pad');
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    if (!result.ok) expect(result.reason).toContain('later stage');
  });

  it('navigating to the current location is a no-op', () => {
    const state = createInitialState();
    const result = navigate(state, 'factory');
    expect(result.ok).toBe(true);
    expect(result.state).toBe(state);
  });

  it('provides an objective for the factory', () => {
    expect(getObjective(createInitialState()).nextAction.length).toBeGreaterThan(0);
  });
});

describe('game store', () => {
  it('sets a notice on rejected navigation and clears it on success', () => {
    const store = useGameStore.getState();
    expect(store.goTo('moon')).toBe(false);
    expect(useGameStore.getState().notice).toMatch(/later stage/);
    expect(useGameStore.getState().currentLocation).toBe('factory');
    expect(useGameStore.getState().goTo('factory')).toBe(true);
    expect(useGameStore.getState().notice).toBeNull();
  });
});
