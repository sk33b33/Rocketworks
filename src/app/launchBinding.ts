import { ascentTargetFor } from '../launch/missionProfile';
import { LaunchRuntime, type LaunchContext } from '../launch/launchRuntime';
import { findCrew } from '../missions/crew';
import { commitState } from '../missions/missionReadiness';
import { hashString } from '../shared/random';
import { deriveFlightVehicle } from '../simulation/ascent/flightVehicle';
import { planFailures } from '../simulation/ascent/failures';
import type { LaunchPadController } from '../scenes/launch-pad/launchPadController';
import { selectMissionReport, useGameStore, type GameStore } from './gameStore';

/** The single launch runtime for the session; outcomes are recorded in the game store. */
export const launchRuntime = new LaunchRuntime((record) =>
  useGameStore.getState().recordFlight(record),
);

export type ContextResult = { ok: true; context: LaunchContext } | { ok: false; reason: string };

/** Builds a launch from the committed mission plan, or explains why there is nothing to launch. */
export function buildLaunchContext(s: GameStore): ContextResult {
  const bp = s.blueprints.find((b) => b.id === s.mission.designId);
  const report = selectMissionReport(s);
  const state = commitState(s.mission, bp, report);
  if (!bp || state === 'planning') {
    return {
      ok: false,
      reason: 'No mission is committed. Plan and commit one in Mission Control.',
    };
  }
  if (state === 'void') {
    return {
      ok: false,
      reason:
        'The mission commitment is void (the vehicle changed or the poll is no longer GO). Re-commit in Mission Control.',
    };
  }
  const mission = report.mission;
  const crewed = mission.requirements.maxCrew > 0;
  const flightNumber = s.flights.length + 1;
  const seed = hashString(
    `${bp.id}:${bp.revision}:${mission.id}:${flightNumber}:${s.mission.conditionsSeed}`,
  );
  return {
    ok: true,
    context: {
      outcome: {
        id: `flight-${flightNumber}-${seed.toString(36)}`,
        at: '',
        missionId: mission.id,
        missionName: mission.name,
        designId: bp.id,
        designName: bp.name,
        crewed,
      },
      blueprint: bp,
      designRevision: bp.revision,
      crewed,
      crewNames: s.mission.crewIds.map((id) => findCrew(id)?.name ?? id),
      config: {
        vehicle: deriveFlightVehicle(bp, report.carriedMassKg),
        target: ascentTargetFor(mission),
        failures: planFailures(seed, report.risk.score, s.ui.randomFailures),
      },
    },
  };
}

/**
 * Called when the Launch Pad opens: rolls out the committed vehicle if nothing is in progress,
 * or replaces a stale rollout whose plan has changed. An active countdown/flight is left alone.
 */
export function syncLaunchWithPlan(): ContextResult {
  const result = buildLaunchContext(useGameStore.getState());
  const snap = launchRuntime.getSnapshot();
  if (!result.ok) {
    if (snap.phase === 'rollout' || snap.phase === 'pad') launchRuntime.reset();
    return result;
  }
  const ctx = snap.context;
  const stale =
    !ctx ||
    ctx.outcome.missionId !== result.context.outcome.missionId ||
    ctx.outcome.designId !== result.context.outcome.designId ||
    ctx.designRevision !== result.context.designRevision;
  const newAttempt = snap.phase === 'debrief' && ctx?.outcome.id !== result.context.outcome.id;
  if (snap.phase === 'idle' || ((snap.phase === 'rollout' || snap.phase === 'pad') && stale)) {
    launchRuntime.prepare(result.context);
  } else if (newAttempt) {
    // After a scrub the vehicle is still on the pad: recycle without another rollout.
    launchRuntime.prepare(result.context, snap.record?.result === 'scrubbed' && !stale);
  }
  return result;
}

/** Adapts the runtime and store to the Launch Pad scene. */
export function createLaunchPadController(): LaunchPadController {
  return {
    runtime: launchRuntime,
    onEnter: () => {
      syncLaunchWithPlan();
    },
    getCameraMode: () => useGameStore.getState().padCamera,
    subscribeCameraReset: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'launch-pad'
        )
          listener();
      }),
  };
}
