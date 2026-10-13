import type { SceneFactories } from '../game/GameScene';
import { FactoryScene } from './factory/FactoryScene';

/** Only implemented locations appear here; locked ones never load blank scenes. */
export const sceneFactories: SceneFactories = {
  factory: () => new FactoryScene(),
};
