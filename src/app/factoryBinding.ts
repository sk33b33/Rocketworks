import type { FactoryController, FactoryView } from '../scenes/factory/factoryController';
import { useGameStore } from './gameStore';

/** Adapts the game store to the factory scene's controller interface. */
export function createFactoryController(): FactoryController {
  const view = (): FactoryView => {
    const s = useGameStore.getState();
    return { blueprint: s.blueprint, selection: s.selection };
  };
  return {
    getView: view,
    subscribe: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (s.blueprint !== prev.blueprint || s.selection !== prev.selection) {
          listener(
            { blueprint: s.blueprint, selection: s.selection },
            { blueprint: prev.blueprint, selection: prev.selection },
          );
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
