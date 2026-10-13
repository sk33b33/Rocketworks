import { createFactoryController } from '../app/factoryBinding';
import { createLaunchPadController } from '../app/launchBinding';
import { createMissionControlController } from '../app/missionControlBinding';
import type { SceneFactories } from '../game/GameScene';
import { FactoryScene } from './factory/FactoryScene';
import { LaunchPadScene } from './launch-pad/LaunchPadScene';
import { MissionControlScene } from './mission-control/MissionControlScene';

/** Only implemented locations appear here; locked ones never load blank scenes. */
export const sceneFactories: SceneFactories = {
  factory: () => new FactoryScene(createFactoryController()),
  'mission-control': () => new MissionControlScene(createMissionControlController()),
  'launch-pad': () => new LaunchPadScene(createLaunchPadController()),
};
