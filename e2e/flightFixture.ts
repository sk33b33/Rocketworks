import { flightContextFromLaunch } from '../src/app/flightBinding';
import { FlightRuntime } from '../src/flight/flightRuntime';
import { formatTMinus } from '../src/launch/countdown';
import type { LaunchContext } from '../src/launch/launchRuntime';
import { encodeJson, type FlightSaveRecord } from '../src/persistence/flightSave';
import { RESERVE_FRACTION } from '../src/recovery/recoveryPlan';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { SIM_DT_S } from '../src/simulation/constants';

/*
 * A real mid-flight autosave for the Low-orbit mission, produced by the game's own runtime in
 * Node: the reference ship is flown to a stable orbit and snapshotted. Building it this way
 * keeps the browser test fast (no minutes-long ascent under software WebGL) while still
 * exercising the exact save format the game writes.
 */

const NOW = '2026-01-01T00:00:00.000Z';

export function orbitingFlightSave(missionId: string): { json: string; clock: string } {
  const bp = createCompleteStarterDesign(NOW);
  const vehicle = deriveFlightVehicle(bp, 300);
  const lc: LaunchContext = {
    outcome: {
      id: 'e2e-flight',
      at: NOW,
      missionId,
      missionName: 'Low Orbit (e2e)',
      designId: bp.id,
      designName: bp.name,
      crewed: true,
    },
    blueprint: bp,
    designRevision: bp.revision,
    crewed: true,
    crewNames: ['Mara Okafor', 'Tomas Lindqvist'],
    config: {
      vehicle,
      target: { kind: 'orbit', altitudeM: 150_000 },
      failures: [],
      boosterReserveKg: vehicle.booster.propellantKg * RESERVE_FRACTION.platform,
    },
  };
  const rt = new FlightRuntime(
    () => undefined,
    () => NOW,
  );
  rt.start(flightContextFromLaunch(lc, simulateAscent(lc.config, SIM_DT_S)));
  for (let i = 0; i < 50_000; i++) {
    if (rt.current.program.program === 'none' && rt.current.progress.orbit) break;
    if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
    rt.update(0.1);
  }
  if (!rt.current.progress.orbit) throw new Error('fixture flight did not reach orbit');
  const runtime = rt.snapshot();
  if (!runtime) throw new Error('fixture flight has no snapshot');
  const record: FlightSaveRecord = {
    version: 1,
    kind: 'flight',
    savedAt: NOW,
    missionId,
    outcomeId: lc.outcome.id,
    runtime,
  };
  return { json: encodeJson(record), clock: formatTMinus(runtime.live.tS) };
}
