import { FlightRuntime, type FlightContext } from '../flight/flightRuntime';
import { ascentToInertial, shipSpecFor } from '../flight/shipSpec';
import type { LaunchContext } from '../launch/launchRuntime';
import type { BoosterRecoverySummary } from '../launch/flightRecord';
import type { AscentState } from '../simulation/ascent/ascentModel';
import type { FlightController } from '../scenes/flight/flightController';
import type { StationController } from '../scenes/station/stationController';
import type { MoonController } from '../scenes/moon/moonController';
import { useGameStore } from './gameStore';
import { launchRuntime } from './launchBinding';
import { findMission } from '../missions/missionCatalog';

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
    ascent: {
      maxAltitudeM: ascent.maxAltitudeM,
      maxSpeedMS: ascent.maxSpeedMS,
      maxQPa: ascent.maxQPa,
      events: ascent.events.map((e) => `T+${Math.round(e.tS)}s ${e.text}`),
    },
  };
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
    const mission = useGameStore.getState().mission;
    const rules = findMission(snap.context.outcome.missionId)?.lunar;
    flightRuntime.start(
      flightContextFromLaunch(
        snap.context,
        snap.ascent,
        snap.recoveryResult,
        {
          crew: snap.context.crewNames.length,
          cargo:
            mission.payloadId === 'station-supplies' || mission.payloadId === 'surface-science',
        },
        rules ? { goal: rules.goal, landing: rules.landing, refuel: mission.refuel } : undefined,
      ),
    );
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
