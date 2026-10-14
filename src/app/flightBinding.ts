import { FlightRuntime, type FlightContext } from '../flight/flightRuntime';
import { ascentToInertial, shipSpecFor } from '../flight/shipSpec';
import type { LaunchContext } from '../launch/launchRuntime';
import type { BoosterRecoverySummary } from '../launch/flightRecord';
import type { AscentState } from '../simulation/ascent/ascentModel';
import type { FlightController } from '../scenes/flight/flightController';
import type { StationController } from '../scenes/station/stationController';
import type { MoonController } from '../scenes/moon/moonController';
import type { MarsController } from '../scenes/mars/marsController';
import { useGameStore } from './gameStore';
import { launchRuntime } from './launchBinding';
import { findMission } from '../missions/missionCatalog';
import { programDay } from '../progression/research';

/** The single orbital-flight runtime; its outcome closes the launch session and is recorded. */
export const flightRuntime = new FlightRuntime((record) => {
  useGameStore.getState().recordFlight(record);
  launchRuntime.completeHandoff();
});

/** Flight context from a launch that reached orbit. Pure. */
export function flightContextFromLaunch(
  ctx: LaunchContext,
  ascent: AscentState,
  recovery: BoosterRecoverySummary | null = null,
  station?: { crew: number; cargo: boolean },
  lunar?: FlightContext['lunar'],
  mars?: FlightContext['mars'],
): FlightContext {
  const { r, v } = ascentToInertial(ascent);
  return {
    outcome: ctx.outcome,
    blueprint: ctx.blueprint,
    designRevision: ctx.designRevision,
    crewed: ctx.crewed,
    crewNames: ctx.crewNames,
    spec: shipSpecFor(ctx.blueprint, ctx.config.vehicle.ship),
    start: { r, v, propKg: ascent.shipPropKg, tS: ascent.tS },
    recovery,
    hardware: ctx.hardware ?? { boosterId: null, shipId: null },
    ...(station ? { station } : {}),
    ...(lunar ? { lunar } : {}),
    ...(mars ? { mars } : {}),
    ascent: {
      maxAltitudeM: ascent.maxAltitudeM,
      maxSpeedMS: ascent.maxSpeedMS,
      maxQPa: ascent.maxQPa,
      events: ascent.events.map((e) => `T+${Math.round(e.tS)}s ${e.text}`),
    },
  };
}

/**
 * Flight context for a launch that reached orbit, with the mission plan from Mission Control
 * (station crew and cargo, Moon refuelling, the Mars launch day and cargo).
 */
export function handoffContext(
  launch: LaunchContext,
  ascent: AscentState,
  recovery: BoosterRecoverySummary | null,
): FlightContext {
  const state = useGameStore.getState();
  const mission = state.mission;
  const def = findMission(launch.outcome.missionId);
  const rules = def?.lunar;
  return flightContextFromLaunch(
    launch,
    ascent,
    recovery,
    {
      crew: launch.crewNames.length,
      cargo: mission.payloadId === 'station-supplies' || mission.payloadId === 'surface-science',
    },
    rules ? { goal: rules.goal, landing: rules.landing, refuel: mission.refuel } : undefined,
    def?.mars
      ? {
          launchDay: programDay(state.progression),
          refuelLeo: mission.refuel.leo,
          plant: !!def.mars.plantPayloadId && mission.payloadId === def.mars.plantPayloadId,
          ...(def.mars.crewed
            ? {
                crewed: true,
                base: state.progression.marsBase ?? null,
                boosted: state.progression.tech.includes('ice-mining'),
              }
            : {}),
        }
      : undefined,
  );
}

/** True when a launch is waiting to hand its ship to the flight runtime. */
export function handoffPending(): boolean {
  return launchRuntime.getSnapshot().phase === 'handoff' && !flightRuntime.active;
}

/** Starts the orbital flight from the pending hand-off and opens the Flight location. */
export function continueToOrbit(): boolean {
  const snap = launchRuntime.getSnapshot();
  if (!flightRuntime.active) {
    if (snap.phase !== 'handoff' || !snap.context || !snap.ascent) return false;
    flightRuntime.start(handoffContext(snap.context, snap.ascent, snap.recoveryResult));
  }
  return useGameStore.getState().goTo('flight');
}

export function createStationController(): StationController {
  return {
    runtime: {
      get current() {
        return flightRuntime.current;
      },
      get proximity() {
        return flightRuntime.proximity;
      },
      update: (dt) => flightRuntime.update(dt),
    },
    getCameraMode: () => useGameStore.getState().stationCamera,
    subscribeCameraReset: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'station'
        )
          listener();
      }),
  };
}

export function createMoonController(): MoonController {
  return {
    runtime: flightRuntime,
    getCameraMode: () => useGameStore.getState().moonCamera,
    subscribeCameraReset: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'moon'
        )
          listener();
      }),
  };
}

export function createMarsController(): MarsController {
  return {
    runtime: flightRuntime,
    getCameraMode: () => useGameStore.getState().marsCamera,
    subscribeCameraReset: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'mars'
        )
          listener();
      }),
  };
}

export function createFlightController(): FlightController {
  return {
    runtime: flightRuntime,
    getCameraMode: () => useGameStore.getState().flightCamera,
    subscribeCameraReset: (listener) =>
      useGameStore.subscribe((s, prev) => {
        if (
          s.cameraRequest &&
          s.cameraRequest !== prev.cameraRequest &&
          s.currentLocation === 'flight'
        )
          listener();
      }),
  };
}
