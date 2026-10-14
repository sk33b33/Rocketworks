import type { FlightSnapshot } from '../../flight/flightRuntime';
import type { ProximityView } from '../../station/proximitySession';

export type StationCameraMode = 'chase' | 'docking' | 'orbit';

/** What the station scene reads and drives (the flight runtime owns proximity operations). */
export interface StationRuntimeView {
  readonly current: FlightSnapshot;
  readonly proximity: ProximityView | null;
  update(realDtS: number): void;
}

export interface StationController {
  readonly runtime: StationRuntimeView;
  getCameraMode(): StationCameraMode;
  subscribeCameraReset(listener: () => void): () => void;
}
