import type { CameraRequest, Selection } from '../../app/gameStore';
import type { RocketBlueprint, SocketRef } from '../../rocket/model/types';

export interface FactoryView {
  readonly blueprint: RocketBlueprint;
  readonly selection: Selection;
  /** Parts unlocked through research, so markers reflect what the player can attach. */
  readonly unlockedPartIds: ReadonlySet<string>;
}

/**
 * The factory scene's only link to game state: it reads a view and reports player picks.
 * Keeps rendering code independent of the store implementation.
 */
export interface FactoryController {
  getView(): FactoryView;
  subscribe(listener: (view: FactoryView, previous: FactoryView) => void): () => void;
  subscribeCamera(listener: (request: CameraRequest) => void): () => void;
  pickInstance(instanceId: string): void;
  pickSocket(ref: SocketRef): void;
  pickNothing(): void;
}
