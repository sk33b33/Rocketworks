import { describe, expect, it } from 'vitest';
import {
  advanceCountdown,
  COUNTDOWN_START_S,
  formatTMinus,
  propellantLoad,
  stepsFor,
  stepStatus,
} from '../src/launch/countdown';
import { ascentRecord } from '../src/launch/flightRecord';
import { LaunchRuntime, type LaunchContext } from '../src/launch/launchRuntime';
import type { FlightRecord } from '../src/launch/flightRecord';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { simulateAscent } from '../src/simulation/ascent/ascentModel';
import { SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';

function context(missionId = 'orbital-flight', crewed = true): LaunchContext {
  const bp = createCompleteStarterDesign(NOW);
  return {
    outcome: {
      id: 'f1',
      at: NOW,
      missionId,
      missionName: 'M',
      designId: bp.id,
      designName: bp.name,
      crewed,
    },
    blueprint: bp,
    designRevision: bp.revision,
    crewed,
    crewNames: crewed ? ['A', 'B'] : [],
    config: {
      vehicle: deriveFlightVehicle(bp, 300),
      target:
        missionId === 'test-flight'
          ? { kind: 'suborbital', secoSpeedMS: 5600, minApogeeM: 100_000 }
          : { kind: 'orbit', altitudeM: 150_000 },
      failures: [],
    },
  };
}

describe('countdown', () => {
  it('compresses time and never passes T-0', () => {
    let c = COUNTDOWN_START_S;
    let real = 0;
    while (c < 0 && real < 1000) {
      c = advanceCountdown(c, 0.25);
      real += 0.25;
    }
    expect(c).toBe(0);
    // 39 min at 60x + 50 s at 5x + 10 s at 1x = 39 + 10 + 10 s real.
    expect(real).toBeGreaterThan(55);
    expect(real).toBeLessThan(62);
    expect(advanceCountdown(-5, 100)).toBe(0);
  });

  it('crosses rate boundaries exactly', () => {
    expect(advanceCountdown(-61, 1)).toBeCloseTo(-60 + 5 * (1 - 1 / 60), 6);
  });

  it('tracks checklist status and propellant load, with crew-specific steps', () => {
    const crewed = stepsFor(true);
    const cargo = stepsFor(false);
    expect(crewed.some((s) => s.id === 'crew')).toBe(true);
    expect(cargo.some((s) => s.id === 'crew')).toBe(false);
    const idx = crewed.findIndex((s) => s.id === 'chill');
    expect(stepStatus(crewed, idx, -9 * 60)).toBe('active');
    expect(stepStatus(crewed, idx, -11 * 60)).toBe('pending');
    expect(stepStatus(crewed, idx, -1 * 60)).toBe('done');
    expect(propellantLoad(-40 * 60)).toEqual({ booster: 0, ship: 0 });
    expect(propellantLoad(-10 * 60)).toEqual({ booster: 1, ship: 1 });
    expect(formatTMinus(-125)).toBe('T-02:05');
    expect(formatTMinus(3725)).toBe('T+1:02:05');
    expect(formatTMinus(3 * 86_400 + 3725)).toBe('T+3d 01:02:05');
  });
});

describe('flight records', () => {
  it('credits only missions fully covered by the ascent', () => {
    const hop = context('test-flight', false);
    expect(ascentRecord(hop.outcome, simulateAscent(hop.config, SIM_DT_S))).toMatchObject({
      result: 'success',
      credited: true,
      crewSafe: null,
    });
    // Orbital missions continue in the flight stage: the ascent alone is never credited.
    const ctx = context('orbital-flight');
    const s = simulateAscent(ctx.config, SIM_DT_S);
    expect(ascentRecord(ctx.outcome, s)).toMatchObject({ result: 'partial', credited: false });
  });
});

describe('LaunchRuntime', () => {
  const run = (rt: LaunchRuntime, seconds: number, dt = 0.1) => {
    for (let t = 0; t < seconds; t += dt) rt.update(dt);
  };

  it('walks rollout → pad → countdown → ascent → debrief and reports a record', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context('test-flight', false));
    expect(rt.getSnapshot().phase).toBe('rollout');
    rt.startCountdown(); // ignored during rollout
    expect(rt.getSnapshot().phase).toBe('rollout');
    rt.skipRollout();
    expect(rt.getSnapshot().phase).toBe('pad');
    rt.startCountdown();
    rt.skipToTerminalCount();
    run(rt, 11);
    expect(rt.getSnapshot().phase).toBe('ascent');
    rt.setWarp(10);
    run(rt, 60);
    expect(rt.getSnapshot().phase).toBe('debrief');
    expect(records).toHaveLength(1);
    expect(records[0]?.result).toBe('success');
  });

  it('holds and resumes the count, and scrubs without flying', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context(), true);
    rt.startCountdown();
    run(rt, 1);
    rt.hold();
    const clock = rt.current.clockS;
    run(rt, 5);
    expect(rt.current.clockS).toBe(clock);
    rt.resume();
    run(rt, 1);
    expect(rt.current.clockS).toBeGreaterThan(clock);
    rt.abort('Weather');
    expect(rt.getSnapshot().phase).toBe('debrief');
    expect(records[0]).toMatchObject({ result: 'scrubbed', credited: false });
  });

  it('pauses the ascent and aborts in flight', () => {
    const records: FlightRecord[] = [];
    const rt = new LaunchRuntime(
      (r) => records.push(r),
      () => NOW,
    );
    rt.prepare(context(), true);
    rt.startCountdown();
    rt.skipToTerminalCount();
    run(rt, 15);
    const t = rt.liveAscent!.tS;
    rt.togglePause();
    run(rt, 3);
    expect(rt.liveAscent!.tS).toBe(t);
    rt.togglePause();
    rt.abort();
    expect(rt.liveAscent!.status).toBe('aborted');
    run(rt, 5);
    expect(records[0]).toMatchObject({ result: 'aborted', crewSafe: true });
  });

  it('caps simulation steps per frame on a huge delta', () => {
    const rt = new LaunchRuntime(
      () => {},
      () => NOW,
    );
    rt.prepare(context(), true);
    rt.startCountdown();
    rt.skipToTerminalCount();
    run(rt, 11);
    rt.setWarp(10);
    const before = rt.liveAscent!.tS;
    rt.update(1000); // pathological frame
    expect(rt.liveAscent!.tS - before).toBeLessThanOrEqual(400 * SIM_DT_S + 1e-6);
  });

  it('publishes throttled snapshots during continuous phases', () => {
    const rt = new LaunchRuntime(
      () => {},
      () => NOW,
    );
    let notifications = 0;
    rt.subscribe(() => notifications++);
    rt.prepare(context());
    notifications = 0;
    for (let i = 0; i < 60; i++) rt.update(1 / 60); // one second of rollout
    expect(notifications).toBeLessThanOrEqual(11);
    expect(rt.current.rolloutProgress).toBeGreaterThan(rt.getSnapshot().rolloutProgress - 1e-9);
  });
});
