import { findCrew } from '../missions/crew';
import { commitState } from '../missions/missionReadiness';
import type {
  MissionControlController,
  MissionControlView,
} from '../scenes/mission-control/missionControlController';
import { selectMissionReport, useGameStore, type GameStore } from './gameStore';

/** Adapts the game store to the Mission Control scene's controller interface. */
export function createMissionControlController(): MissionControlController {
  const toView = (s: GameStore): MissionControlView => {
    const report = selectMissionReport(s);
    const bp = s.blueprints.find((b) => b.id === s.mission.designId);
    return {
      report,
      designName: bp?.name ?? null,
      crewNames: s.mission.crewIds.map((id) => findCrew(id)?.name ?? id),
      commitState: commitState(s.mission, bp, report),
    };
  };
  return {
    getView: () => toView(useGameStore.getState()),
    subscribe: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.mission !== prev.mission ||
          s.blueprints !== prev.blueprints ||
          s.progression !== prev.progression
        ) {
          listener(toView(s));
        }
      }),
    subscribeCamera: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'mission-control'
        ) {
          listener(s.cameraRequest);
        }
      }),
  };
}
