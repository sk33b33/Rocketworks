import type { FlightSnapshot } from '../../flight/flightRuntime';
import type { FlightState } from '../../flight/flightModel';

export type FlightCameraMode = 'chase' | 'orbit' | 'map';

/** The pieces of the flight runtime the scene drives and reads. */
export interface FlightRuntimeView {
  readonly current: FlightSnapshot;
  readonly liveState: FlightState | null;
  update(realDtS: number): void;
}

/** The Flight scene's link to the app (injected; the scene never imports the store). */
export interface FlightController {
  readonly runtime: FlightRuntimeView;
  getCameraMode(): FlightCameraMode;
  subscribeCameraReset(listener: () => void): () => void;
}
