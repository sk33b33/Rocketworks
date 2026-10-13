import type { LaunchSnapshot } from '../../launch/launchRuntime';
import type { AscentState } from '../../simulation/ascent/ascentModel';
import type { RecoverySessionView } from '../../recovery/recoverySession';

export type PadCameraMode = 'pad' | 'follow' | 'cinematic' | 'landing';

/** The pieces of the launch runtime the scene drives and reads. */
export interface LaunchRuntimeView {
  readonly current: LaunchSnapshot;
  readonly liveAscent: AscentState | null;
  /** Booster recovery replay (null when there is none). */
  readonly liveRecovery: RecoverySessionView | null;
  update(realDtS: number): void;
}

/** The Launch Pad scene's link to the app: runtime access, camera mode and reset requests. */
export interface LaunchPadController {
  readonly runtime: LaunchRuntimeView;
  /** Called when the pad becomes active (rolls out the committed vehicle if needed). */
  onEnter(): void;
  getCameraMode(): PadCameraMode;
  subscribeCameraReset(listener: () => void): () => void;
}
