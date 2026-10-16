import type { FlightState } from '../../flight/flightModel';
import type { EvaState } from '../../surface/eva';
import type { FlightSnapshot } from '../../flight/flightRuntime';

/** Chase the ship, watch from the landing site, see the whole planet, or the solar system. */
export type MarsCameraMode = 'chase' | 'site' | 'planet' | 'system';

/** What the Mars scene reads and drives (the flight runtime owns the Mars flight). */
export interface MarsRuntimeView {
  readonly current: FlightSnapshot;
  readonly liveState: FlightState | null;
  /** An astronaut outside on the surface (null when everyone is aboard). */
  readonly evaState: EvaState | null;
  update(realDtS: number): void;
}

export interface MarsController {
  readonly runtime: MarsRuntimeView;
  getCameraMode(): MarsCameraMode;
  subscribeCameraReset(listener: () => void): () => void;
}
