import { describe, expect, it } from 'vitest';
import { continueToOrbit, flightContextFromLaunch, handoffPending } from '../src/app/flightBinding';
import { IDLE_PROGRAM, runProgram, slewRate, type ProgramState } from '../src/flight/autopilot';
import {
  FLIGHT,
  heatFlux,
  initialFlightState,
  stepFlight,
  touchdownMetrics,
  type FlightState,
} from '../src/flight/flightModel';
import { evaluateFlight, NO_PROGRESS, type FlightProgress } from '../src/flight/flightOutcome';
import { FlightRuntime, programAvailability, warpLimit } from '../src/flight/flightRuntime';
import { TRACK_MAX_SAMPLES } from '../src/flight/flightTrack';
import { findZone, findZoneAt, LANDING_ZONES, missDistanceM } from '../src/flight/landingZones';
import {
  localFrame,
  orbitalElements,
  orbitPath,
  surfacePoint,
  timeToApsides,
  visVivaSpeed,
  wrapAngle,
} from '../src/flight/orbitMath';
import { ascentToInertial, deriveShipSpec, shipOnlyBlueprint } from '../src/flight/shipSpec';
import type { FlightRecord } from '../src/launch/flightRecord';
import { LaunchRuntime, type LaunchContext } from '../src/launch/launchRuntime';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { EARTH_RADIUS_M, SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';
const bp = createCompleteStarterDesign(NOW);
const spec = deriveShipSpec(bp, 300);

function circular(altM: number, angle = 0): FlightState {
  const r = surfacePoint(angle, altM);
  const up = localFrame(r).up;
  const speed = visVivaSpeed(EARTH_RADIUS_M + altM, EARTH_RADIUS_M + altM, EARTH_RADIUS_M + altM);
  return initialFlightState(r, [up[1] * speed, -up[0] * speed], 60_000);
}

function launchContext(missionId = 'orbital-flight'): LaunchContext {
  return {
    outcome: {
      id: 'f1',
      at: NOW,
      missionId,
      missionName: 'M',
      designId: bp.id,
      designName: bp.name,
      crewed: true,
    },
    blueprint: bp,
    designRevision: bp.revision,
    crewed: true,
    crewNames: ['A', 'B'],
    config: {
      vehicle: deriveFlightVehicle(bp, 300),
      target: { kind: 'orbit', altitudeM: 150_000 },
      failures: [],
    },
  };
}

describe('orbit math', () => {
  it('describes circular, elliptical and suborbital states', () => {
    const c = orbitalElements(circular(200_000).r, circular(200_000).v);
    expect(c.status).toBe('orbit');
    expect(c.eccentricity).toBeLessThan(1e-6);
    expect(c.apoapsisAltM).toBeCloseTo(200_000, -1);
    expect(c.periodS).toBeGreaterThan(5_200);
    expect(c.periodS).toBeLessThan(5_400);

    const s = circular(150_000);
    const slow = orbitalElements(s.r, [s.v[0] * 0.98, s.v[1] * 0.98]);
    expect(slow.status).toBe('suborbital');
    expect(slow.apoapsisAltM).toBeCloseTo(150_000, -2);
    expect(slow.periapsisAltM).toBeLessThan(120_000);
    const fast = orbitalElements(s.r, [s.v[0] * 1.5, s.v[1] * 1.5]);
    expect(fast.status).toBe('escape');
    expect(orbitPath(fast, 0)).toEqual([]);
  });

  it('samples paths and apsis timing consistently', () => {
    const s = circular(150_000);
    const el = orbitalElements(s.r, [s.v[0] * 1.01, s.v[1] * 1.01]);
    const path = orbitPath(el, 0, 64);
    expect(path).toHaveLength(65);
    const radii = path.map((p) => p.radiusM);
    expect(Math.min(...radii)).toBeCloseTo(EARTH_RADIUS_M + el.periapsisAltM, -3);
    expect(Math.max(...radii)).toBeCloseTo(EARTH_RADIUS_M + el.apoapsisAltM, -4);
    // Burned prograde at this point, so this is periapsis; apoapsis is half an orbit away.
    const t = timeToApsides(s.r, s.v, el);
    expect(Math.abs(t.toApoS - el.periodS / 2)).toBeLessThan(60);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it('converts the ascent frame to inertial coordinates', () => {
    const { r, v } = ascentToInertial({
      downrangeM: 0,
      altitudeM: 1000,
      vHorizMS: 100,
      vVertMS: 10,
    });
    expect(r).toEqual([0, EARTH_RADIUS_M + 1000]);
    expect(v[0]).toBeCloseTo(100); // east at the launch site is +x
    expect(v[1]).toBeCloseTo(10);
  });
});

describe('flight model', () => {
  it('heats with density and the cube of speed', () => {
    expect(heatFlux(0, 7_800)).toBe(0);
    expect(heatFlux(1e-4, 7_000) / heatFlux(1e-4, 3_500)).toBeCloseTo(8);
    expect(heatFlux(4e-4, 5_000) / heatFlux(1e-4, 5_000)).toBeCloseTo(2);
  });

  it('keeps a circular orbit stable at the coarse warp step', () => {
    let s = circular(200_000);
    const c = { targetPitchDeg: 0, bankDeg: 0, yawDeg: 0, throttle: 0, slewDegS: 8 };
    for (let i = 0; i < 5_400; i++) s = stepFlight(s, spec, c, 1);
    const el = orbitalElements(s.r, s.v);
    expect(Math.abs(el.periapsisAltM - 200_000)).toBeLessThan(3_000);
    expect(Math.abs(el.apoapsisAltM - 200_000)).toBeLessThan(3_000);
  });

  it('limits thrust acceleration with the engine governor', () => {
    let s = { ...circular(200_000), propKg: 5_000 };
    s = stepFlight(
      s,
      spec,
      { targetPitchDeg: 0, bankDeg: 0, yawDeg: 0, throttle: 1, slewDegS: 8 },
      0.05,
    );
    expect(s.gLoad).toBeLessThanOrEqual(FLIGHT.maxThrustG + 1e-6);
  });

  it('burns up nose-first but survives belly-first with a full heat shield', () => {
    const entry = (bellyFirst: boolean, coverage = 1) => {
      const sp = { ...spec, shieldCoverage: coverage };
      let s = circular(120_000);
      s = { ...s, v: [s.v[0] * 0.985, s.v[1] * 0.985] };
      for (
        let i = 0;
        i < 40_000 && s.phase === 'flight' && localFrame(s.r).altitudeM > 15_000;
        i++
      ) {
        const gamma = orbitalElements(s.r, s.v).flightPathAngleDeg;
        s = stepFlight(
          s,
          sp,
          {
            targetPitchDeg: gamma + (bellyFirst ? 65 : 0),
            bankDeg: 0,
            yawDeg: 0,
            throttle: 0,
            slewDegS: 90,
          },
          0.1,
        );
      }
      return s;
    };
    const belly = entry(true);
    expect(belly.phase).toBe('flight');
    expect(belly.hull).toBeGreaterThan(0.9);
    expect(belly.shield).toBeLessThan(1);
    expect(entry(false).phase).toBe('destroyed');
    expect(entry(true, 0).phase).toBe('destroyed');
  });

  it('classifies touchdowns by speed and tilt', () => {
    const r = surfacePoint(0, 0.1);
    const gentle = { ...initialFlightState(r, [0, -3], 1_000), pitchDeg: 90 };
    const landed = stepFlight(
      gentle,
      spec,
      { targetPitchDeg: 90, bankDeg: 0, yawDeg: 0, throttle: 0, slewDegS: 0 },
      0.1,
    );
    expect(landed.phase).toBe('landed');
    const hard = { ...initialFlightState(r, [0, -20], 1_000), pitchDeg: 90 };
    expect(
      stepFlight(
        hard,
        spec,
        { targetPitchDeg: 90, bankDeg: 0, yawDeg: 0, throttle: 0, slewDegS: 0 },
        0.1,
      ).phase,
    ).toBe('splashdown');
    const fast = { ...initialFlightState(r, [0, -80], 1_000), pitchDeg: 90 };
    expect(
      stepFlight(
        fast,
        spec,
        { targetPitchDeg: 90, bankDeg: 0, yawDeg: 0, throttle: 0, slewDegS: 0 },
        0.1,
      ).phase,
    ).toBe('crashed');
    expect(touchdownMetrics(r, [3, -4], 80)).toEqual({ vertMS: 4, horizMS: 3, tiltDeg: 10 });
  });
});

describe('landing zones', () => {
  it('measures along-track misses and finds the zone a ship came down in', () => {
    const platform = findZone('platform')!;
    const at = platform.groundAngle + 1_000 / EARTH_RADIUS_M;
    expect(missDistanceM(at, platform)).toBeCloseTo(1_000, 0);
    expect(findZoneAt(at)?.id).toBe('platform');
    expect(findZoneAt(platform.groundAngle + 0.1)).toBeUndefined();
    expect(LANDING_ZONES.every((z) => z.toleranceM > 0)).toBe(true);
  });
});

/** Flies the assisted profile (circularize → one orbit → deorbit → re-entry → landing). */
function flyAssisted(zoneId: string): FlightState {
  const zone = findZone(zoneId)!;
  const asc = simulateAscent(launchContext().config, SIM_DT_S);
  const { r, v } = ascentToInertial(asc);
  let s = initialFlightState(r, v, asc.shipPropKg, asc.tS);
  let ps: ProgramState = { ...IDLE_PROGRAM, program: 'circularize' };
  let travel = 0;
  let last = localFrame(s.r).groundAngle;
  for (let i = 0; i < 400_000 && s.phase === 'flight'; i++) {
    const out = runProgram(ps, s, spec, zone);
    ps = out.next;
    if (ps.program === 'none') {
      const a = localFrame(s.r).groundAngle;
      travel += wrapAngle(a - last);
      last = a;
      if (travel > 2 * Math.PI) ps = { ...IDLE_PROGRAM, program: 'deorbit' };
    }
    const coast = out.controls.throttle === 0 && localFrame(s.r).altitudeM > 140_000;
    s = stepFlight(
      s,
      spec,
      { ...out.controls, yawDeg: 0, slewDegS: slewRate(s) },
      coast ? 1 : 0.05,
    );
  }
  return s;
}

describe('assisted flight', () => {
  it.each(LANDING_ZONES.map((z) => z.id))('lands on target at %s', (zoneId) => {
    const zone = findZone(zoneId)!;
    const s = flyAssisted(zoneId);
    expect(s.phase).toBe('landed');
    expect(Math.abs(missDistanceM(localFrame(s.r).groundAngle, zone))).toBeLessThan(
      zone.toleranceM,
    );
    expect(s.hull).toBeGreaterThan(0.9);
    expect(s.peakG).toBeLessThan(FLIGHT.crewGWarning);
  });
});

describe('flight outcome', () => {
  const ctx = {
    outcome: {
      id: 'f',
      at: NOW,
      missionId: 'orbital-flight',
      missionName: 'M',
      designId: 'd',
      designName: 'D',
      crewed: true,
    },
    zone: findZone('platform')!,
    ascent: { maxAltitudeM: 150_000, maxSpeedMS: 7_800, maxQPa: 30_000, events: ['T+1s Liftoff'] },
    maxAltitudeM: 160_000,
    maxSpeedMS: 7_900,
  };
  const orbited: FlightProgress = {
    orbit: true,
    travelSinceOrbit: 7,
    deorbit: true,
    reentry: true,
  };
  const down = (angle: number, phase: FlightState['phase']): FlightState => ({
    ...initialFlightState(surfacePoint(angle), [0, 0], 1_000),
    phase,
  });

  it('credits the shakedown for a safe landing after a full orbit', () => {
    const rec = evaluateFlight(ctx, down(ctx.zone.groundAngle, 'landed'), orbited, NOW);
    expect(rec).toMatchObject({
      result: 'success',
      credited: true,
      crewSafe: true,
      maxAltitudeM: 160_000,
    });
    expect(rec.landing).toMatchObject({ outcome: 'landed', shipRecovered: true, orbits: 1 });
    expect(rec.events[0]).toBe('T+1s Liftoff');
  });

  it('distinguishes ocean splashdowns, crashes and incomplete objectives', () => {
    const ocean = evaluateFlight(ctx, down(-1.5, 'landed'), orbited, NOW);
    expect(ocean).toMatchObject({ result: 'success', crewSafe: true });
    expect(ocean.landing).toMatchObject({ outcome: 'splashdown', shipRecovered: false });
    const hardOnLand = evaluateFlight(ctx, down(0.01, 'splashdown'), orbited, NOW);
    expect(hardOnLand).toMatchObject({ result: 'failure', crewSafe: false });
    const noLap = evaluateFlight(
      ctx,
      down(ctx.zone.groundAngle, 'landed'),
      { ...orbited, travelSinceOrbit: 2 },
      NOW,
    );
    expect(noLap).toMatchObject({ result: 'partial', credited: false });
    const station = evaluateFlight(
      { ...ctx, outcome: { ...ctx.outcome, missionId: 'station-docking' } },
      down(ctx.zone.groundAngle, 'landed'),
      orbited,
      NOW,
    );
    expect(station).toMatchObject({ result: 'partial', credited: false });
    const stranded = evaluateFlight(ctx, circular(200_000), orbited, NOW);
    expect(stranded).toMatchObject({ result: 'aborted', credited: false });
    expect(evaluateFlight(ctx, down(0, 'destroyed'), NO_PROGRESS, NOW).crewSafe).toBe(false);
  });
});

describe('FlightRuntime', () => {
  it('limits warp in the atmosphere and while burning', () => {
    const high = circular(200_000);
    expect(warpLimit(high, IDLE_PROGRAM, 0).max).toBe(1000);
    expect(warpLimit(high, IDLE_PROGRAM, 0.5).max).toBe(10);
    expect(warpLimit(circular(80_000), IDLE_PROGRAM, 0).max).toBe(10);
  });

  it('explains why programs are unavailable', () => {
    const s = circular(200_000);
    expect(programAvailability('deorbit', s, NO_PROGRESS)).toMatchObject({ ok: false });
    expect(programAvailability('deorbit', s, { ...NO_PROGRESS, orbit: true }).ok).toBe(true);
    expect(programAvailability('landing', s, NO_PROGRESS).reason).toMatch(/30 km/);
    expect(programAvailability('circularize', s, NO_PROGRESS).reason).toMatch(/already circular/);
  });

  it('flies a launch hand-off to a credited landing and records it once', () => {
    // Launch: an orbital mission hands off instead of opening a debrief.
    const launchRecords: FlightRecord[] = [];
    const launch = new LaunchRuntime(
      (r) => launchRecords.push(r),
      () => NOW,
    );
    launch.prepare(launchContext(), true);
    launch.startCountdown();
    launch.skipToTerminalCount();
    for (let t = 0; t < 11; t += 0.1) launch.update(0.1);
    launch.setWarp(10);
    for (let t = 0; t < 120 && launch.current.phase !== 'handoff'; t += 0.1) launch.update(0.1);
    expect(launch.current.phase).toBe('handoff');
    expect(launchRecords).toHaveLength(0);

    const records: FlightRecord[] = [];
    const rt = new FlightRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    const snap = launch.getSnapshot();
    rt.start(flightContextFromLaunch(snap.context!, snap.ascent!));
    expect(rt.current.phase).toBe('flight');
    rt.setZone('rtls');
    rt.setWarp(1000);
    const frame = () => rt.update(0.1);
    // Coast (and circularize if needed) until one full orbit is done, then deorbit.
    for (let i = 0; i < 20_000 && rt.current.progress.travelSinceOrbit < 2 * Math.PI; i++) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(1000);
      frame();
    }
    expect(rt.current.progress.orbit).toBe(true);
    expect(rt.engage('deorbit').ok).toBe(true);
    for (let i = 0; i < 60_000 && rt.current.phase === 'flight'; i++) {
      if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
      frame();
    }
    expect(rt.current.phase).toBe('debrief');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: 'success', credited: true, crewSafe: true });
    expect(records[0]?.landing?.zoneName).toBe(findZone('rtls')!.name);
    expect(rt.current.state?.peakG ?? 99).toBeLessThan(5);

    // The flight was recorded and replays from orbit insertion to the end, then hands back.
    const track = rt.flightTrack;
    expect(track.samples.length).toBeGreaterThan(20);
    expect(track.samples.length).toBeLessThanOrEqual(TRACK_MAX_SAMPLES);
    const final = rt.liveState;
    expect(rt.startReplay(64).ok).toBe(true);
    expect(rt.liveState?.tS).toBeCloseTo(track.samples[0]!.s.tS, 6);
    for (let i = 0; i < 100_000 && rt.replay.getSnapshot()?.playing; i++) rt.update(0.5);
    expect(rt.replay.getSnapshot()).toMatchObject({ playing: false, t: track.duration });
    expect(rt.current.phase).toBe('debrief');
    expect(records).toHaveLength(1);
    rt.replay.stop();
    expect(rt.liveState).toBe(final);
    rt.reset();
    expect(track.samples).toHaveLength(0);
    expect(rt.replayAvailability().ok).toBe(false);
  });

  it('plans a manoeuvre node, shows the orbit it gives and flies it', () => {
    const rt = new FlightRuntime(
      () => {},
      () => NOW,
    );
    rt.start(
      flightContextFromLaunch(launchContext(), simulateAscent(launchContext().config, SIM_DT_S)),
    );
    const frames = (n: number, until: () => boolean) => {
      for (let i = 0; i < n && !until(); i++) {
        if (rt.current.warp < rt.current.maxWarp) rt.setWarp(rt.current.maxWarp);
        rt.update(0.1);
      }
    };
    frames(50_000, () => rt.current.program.program === 'none' && rt.current.progress.orbit);
    expect(rt.engage('execute-node').reason).toMatch(/Plan a manoeuvre node/);
    const s = rt.liveState!;
    const el = orbitalElements(s.r, s.v);
    // A node half an orbit ahead that lifts the far side by about 150 km.
    const r0 = Math.hypot(...s.r);
    const dv = visVivaSpeed(r0, r0 + 150_000, r0) - Math.hypot(...s.v);
    const tNode = s.tS + el.periodS / 2;
    expect(rt.setNode({ tS: tNode, progradeMS: dv, radialMS: 0 }).ok).toBe(true);
    rt.update(0.1);
    const plan = rt.current.nodePlan!;
    expect(plan.dvMS).toBeCloseTo(dv, 3);
    const planned = plan.elements.apoapsisAltM;
    expect(planned).toBeGreaterThan(el.apoapsisAltM + 100_000);
    // Too much Δv for the ship is refused with a reason.
    rt.setNode({ tS: tNode, progradeMS: 1_500, radialMS: 1_500 });
    expect(rt.engage('execute-node').reason).toMatch(/needs .* m\/s; the ship has/);
    rt.setNode({ tS: tNode, progradeMS: dv, radialMS: 0 });
    // The node survives a save and resume.
    const snap = JSON.parse(JSON.stringify(rt.snapshot()));
    const copy = new FlightRuntime(
      () => {},
      () => NOW,
    );
    copy.restore(snap);
    copy.update(0.1);
    expect(copy.current.node).toEqual(rt.current.node);
    expect(rt.engage('execute-node').ok).toBe(true);
    frames(100_000, () => rt.current.program.program === 'none');
    expect(rt.current.message).toMatch(/Node executed/);
    expect(rt.current.node).toBeNull();
    const after = orbitalElements(rt.liveState!.r, rt.liveState!.v);
    // A finite burn lands close to the impulsive prediction.
    expect(Math.abs(after.apoapsisAltM - planned)).toBeLessThan(15_000);
    expect(after.periapsisAltM).toBeGreaterThan(el.periapsisAltM - 15_000);
  });

  it('disengages the autopilot on manual input and keeps the attitude', () => {
    const rt = new FlightRuntime(
      () => {},
      () => NOW,
    );
    const ctx = flightContextFromLaunch(
      launchContext(),
      simulateAscent(launchContext().config, SIM_DT_S),
    );
    rt.start(ctx);
    rt.engage('none');
    rt.setKey('pitch-up', true);
    rt.update(0.5);
    rt.setKey('pitch-up', false);
    expect(rt.current.mode).toBe('manual');
    expect(rt.current.program.program).toBe('none');
    expect(rt.current.manual.pitchDeg).toBeGreaterThan(5);
    rt.endFlight();
    expect(rt.current.record?.result).toBe('aborted');
  });
});

it('builds a ship-only blueprint rooted at the ship', () => {
  const ship = shipOnlyBlueprint(bp);
  expect(ship.parts.length).toBeGreaterThan(3);
  expect(ship.parts.filter((p) => p.parent.parentId === null)).toHaveLength(1);
  expect(ship.parts.some((p) => p.partId.startsWith('booster'))).toBe(false);
});

it('only continues to orbit when a launch is waiting to hand off', () => {
  expect(handoffPending()).toBe(false);
  expect(continueToOrbit()).toBe(false);
});
