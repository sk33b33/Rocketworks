import { flightRuntime, handoffContext } from './flightBinding';
import { launchRuntime, setFlightBusyCheck } from './launchBinding';
import { useGameStore } from './gameStore';
import { makeNotice, now } from './store/commit';
import { FlightRuntime, type RuntimeSnapshot } from '../flight/flightRuntime';
import { getBrowserStorage, type KeyValueStorage } from '../persistence/saveGame';
import {
  clearFlightSave,
  readFlightSave,
  writeFlightSave,
  type FlightSaveRecord,
} from '../persistence/flightSave';
import type { LocationId } from './locations';
import { formatTMinus } from '../launch/countdown';

/*
 * Autosave and resume of an in-progress flight: written every 30 s, on every location change and
 * when the page is hidden; cleared once the flight is scored. On start-up a saved flight resumes
 * paused at its location. A launch still on its way up can't resume (only the orbital flight is
 * resumable) and is reported instead.
 */

const AUTOSAVE_INTERVAL_MS = 30_000;

const busyPhases = new Set(['flight', 'proximity', 'surface']);

/** Where a resumed flight belongs. */
export function locationFor(snap: RuntimeSnapshot): LocationId {
  if (snap.phase === 'proximity') return 'station';
  if (snap.phase === 'voyage' || snap.context.mars) return snap.live.origin ? 'mars' : 'flight';
  if (snap.phase === 'surface' || snap.live.ref === 'moon') return 'moon';
  return 'flight';
}

/** The record to save right now (null = nothing in progress; clear the slot). */
export function currentFlightRecord(): FlightSaveRecord | null {
  const savedAt = now();
  const snap = flightRuntime.snapshot();
  const ctx = flightRuntime.current.context;
  if (snap && ctx)
    return {
      version: 1,
      kind: 'flight',
      savedAt,
      missionId: ctx.outcome.missionId,
      outcomeId: ctx.outcome.id,
      runtime: snap,
    };
  const launch = launchRuntime.getSnapshot();
  if (launch.context && launch.phase === 'handoff' && launch.ascent && !flightRuntime.active) {
    // Orbit reached but not yet taken over: save it as a flight that hasn't started.
    const ctx2 = handoffContext(launch.context, launch.ascent, launch.recoveryResult);
    const temp = new FlightRuntime(() => undefined);
    temp.start(ctx2);
    const s2 = temp.snapshot();
    return s2
      ? {
          version: 1,
          kind: 'flight',
          savedAt,
          missionId: ctx2.outcome.missionId,
          outcomeId: ctx2.outcome.id,
          runtime: s2,
        }
      : null;
  }
  if (
    launch.context &&
    (launch.phase === 'countdown' || launch.phase === 'ascent' || launch.phase === 'recovery')
  )
    return {
      version: 1,
      kind: 'ascent',
      savedAt,
      missionId: launch.context.outcome.missionId,
      missionName: launch.context.outcome.missionName,
    };
  return null;
}

export function saveFlightNow(storage: KeyValueStorage): void {
  const rec = currentFlightRecord();
  if (rec) writeFlightSave(storage, rec);
  else clearFlightSave(storage);
}

/** Restores a saved flight (if any) and starts autosaving. Call once at start-up. */
export function initFlightAutosave(): void {
  const { storage, persistent } = getBrowserStorage();
  setFlightBusyCheck(() => busyPhases.has(flightRuntime.current.phase));
  if (!persistent) return;
  resumeSavedFlight(storage);
  const save = () => saveFlightNow(storage);
  window.setInterval(save, AUTOSAVE_INTERVAL_MS);
  useGameStore.subscribe((s, prev) => {
    if (s.currentLocation !== prev.currentLocation) save();
    // A recorded flight ends the session: drop the slot.
    if (s.flights !== prev.flights) save();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  window.addEventListener('pagehide', save);
}

export function resumeSavedFlight(storage: KeyValueStorage): void {
  const loaded = readFlightSave(storage);
  const store = useGameStore.getState();
  if (loaded.status === 'none') return;
  if (loaded.status === 'corrupt') {
    clearFlightSave(storage);
    useGameStore.setState({
      notice: makeNotice(
        'warning',
        `A saved flight could not be restored (${loaded.reason}) and was discarded. The rest of your program is fine; the mission is still committed.`,
        true,
      ),
    });
    return;
  }
  const rec = loaded.record;
  const committed = !!store.mission.commit && store.mission.missionId === rec.missionId;
  if (rec.kind === 'ascent') {
    clearFlightSave(storage);
    useGameStore.setState({
      notice: makeNotice(
        'info',
        `The launch of "${rec.missionName}" was interrupted by the reload; launches can't resume until orbit.${committed ? ' The mission is still committed: roll out again from the Launch Pad.' : ''}`,
        true,
      ),
    });
    return;
  }
  if (!committed) {
    // The plan moved on (re-planned or already recorded): the snapshot no longer belongs.
    clearFlightSave(storage);
    return;
  }
  try {
    flightRuntime.restore(rec.runtime);
  } catch {
    flightRuntime.reset();
    clearFlightSave(storage);
    useGameStore.setState({
      notice: makeNotice(
        'warning',
        'A saved flight could not be restored and was discarded.',
        true,
      ),
    });
    return;
  }
  const where = locationFor(rec.runtime);
  useGameStore.getState().goTo(where);
  useGameStore.setState({
    notice: makeNotice(
      'success',
      `Flight resumed: ${rec.runtime.context.outcome.missionName} at ${formatTMinus(rec.runtime.live.tS)}. It is paused: press Resume (or Space) to continue.`,
      true,
    ),
  });
}
