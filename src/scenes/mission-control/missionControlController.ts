import type { CameraRequest } from '../../app/gameStore';
import type { CommitState, MissionReport } from '../../missions/missionReadiness';

/** Data the control-room wall screens display. */
export interface MissionControlView {
  readonly report: MissionReport;
  readonly designName: string | null;
  readonly crewNames: readonly string[];
  readonly commitState: CommitState;
}

/** The Mission Control scene's only link to game state (read-only plus camera requests). */
export interface MissionControlController {
  getView(): MissionControlView;
  subscribe(listener: (view: MissionControlView) => void): () => void;
  subscribeCamera(listener: (request: CameraRequest) => void): () => void;
}
