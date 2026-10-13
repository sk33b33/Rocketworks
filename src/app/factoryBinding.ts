import type { FactoryController, FactoryView } from '../scenes/factory/factoryController';
import { selectProgram, useGameStore, type GameStore } from './gameStore';

/** Adapts the game store to the factory scene's controller interface. */
export function createFactoryController(): FactoryController {
  const toView = (s: GameStore): FactoryView => ({
    blueprint: s.blueprint,
    selection: s.selection,
    unlockedPartIds: selectProgram(s).unlockedPartIds,
  });
  const view = (): FactoryView => toView(useGameStore.getState());
  return {
    getView: view,
    subscribe: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.blueprint !== prev.blueprint ||
          s.selection !== prev.selection ||
          s.progression !== prev.progression
        ) {
          listener(toView(s), toView(prev));
        }
      }),
    subscribeCamera: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (s.cameraRequest && s.cameraRequest !== prev.cameraRequest) listener(s.cameraRequest);
      }),
    pickInstance: (id) => useGameStore.getState().selectInstance(id),
    pickSocket: (ref) => {
      useGameStore.getState().attachSelectedTo(ref);
    },
    pickNothing: () => {
      const s = useGameStore.getState();
      if (s.selection?.kind === 'instance') s.clearSelection();
    },
  };
}
