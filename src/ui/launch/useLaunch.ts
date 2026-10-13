import { useSyncExternalStore } from 'react';
import { launchRuntime } from '../../app/launchBinding';
import type { LaunchSnapshot } from '../../launch/launchRuntime';

/** Throttled launch snapshot (≤10 updates/s), safe for React rendering. */
export function useLaunchSnapshot(): LaunchSnapshot {
  return useSyncExternalStore(launchRuntime.subscribe, launchRuntime.getSnapshot);
}
