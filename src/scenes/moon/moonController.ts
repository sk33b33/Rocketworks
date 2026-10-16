import type { FlightState } from '../../flight/flightModel';
import type { EvaState } from '../../surface/eva';
import type { FlightSnapshot } from '../../flight/flightRuntime';

export type MoonCameraMode = 'chase' | 'landing' | 'orbit';

/** What the Moon scene reads and drives (the flight runtime owns the lunar flight). */
export interface MoonRuntimeView {
  readonly current: FlightSnapshot;
  readonly liveState: FlightState | null;
  /** An astronaut outside on the surface (null when everyone is aboard). */
  readonly evaState: EvaState | null;
  update(realDtS: number): void;
}

export interface MoonController {
  readonly runtime: MoonRuntimeView;
  getCameraMode(): MoonCameraMode;
  subscribeCameraReset(listener: () => void): () => void;
}
