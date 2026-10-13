import { describe, expect, it } from 'vitest';
import { removePart } from '../src/rocket/assembly/operations';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';
import {
  abortAscent,
  effectiveGravity,
  initialAscentState,
  simulateAscent,
  stepAscent,
  type AscentConfig,
  type AscentTarget,
} from '../src/simulation/ascent/ascentModel';
import { deriveFlightVehicle } from '../src/simulation/ascent/flightVehicle';
import { planFailures } from '../src/simulation/ascent/failures';
import { circularSpeed, G0_MS2, SIM_DT_S } from '../src/simulation/constants';

const NOW = '2026-01-01T00:00:00.000Z';
const ORBIT: AscentTarget = { kind: 'orbit', altitudeM: 150_000 };
const SUB: AscentTarget = { kind: 'suborbital', secoSpeedMS: 5_600, minApogeeM: 100_000 };
const ref = () => createCompleteStarterDesign(NOW);
const cfg = (bp: RocketBlueprint, target: AscentTarget = ORBIT, carried = 0): AscentConfig => ({
  vehicle: deriveFlightVehicle(bp, carried),
  target,
  failures: [],
});

function strip(bp: RocketBlueprint, partId: string, keep: number): RocketBlueprint {
  let cur = bp;
  for (const p of bp.parts.filter((x) => x.partId === partId).slice(keep)) {
    const r = removePart(cur, p.id, NOW);
    if (r.ok) cur = r.blueprint;
  }
  return cur;
}

describe('flight vehicle', () => {
  it('splits mass and engines by stage and adds carried mass to the ship', () => {
    const v = deriveFlightVehicle(ref(), 5_000);
    const plain = deriveFlightVehicle(ref());
    expect(v.booster.engineCount).toBe(13);
    expect(v.ship.engineCount).toBe(6);
    expect(v.ship.dryMassKg - plain.ship.dryMassKg).toBe(5_000);
    expect(v.booster.thrustVacPerEngineN).toBeGreaterThan(v.booster.thrustSlPerEngineN);
  });
});

describe('ascent model', () => {
  it('has gravity that vanishes at circular speed', () => {
    expect(effectiveGravity(0, 0)).toBeCloseTo(9.82, 1);
    expect(Math.abs(effectiveGravity(150_000, circularSpeed(150_000)))).toBeLessThan(1e-6);
  });

  it('flies the reference design to orbit with staging and max-Q', () => {
    const s = simulateAscent(cfg(ref()), SIM_DT_S);
    expect(s.status).toBe('orbit');
    expect(s.stage).toBe('ship');
    expect(s.vHorizMS).toBeGreaterThanOrEqual(circularSpeed(s.altitudeM));
    expect(s.shipPropKg).toBeGreaterThan(0);
    const texts = s.events.map((e) => e.text).join(' | ');
    expect(texts).toMatch(/Liftoff/);
    expect(texts).toMatch(/Max-Q/);
    expect(texts).toMatch(/hot staging/);
    expect(s.maxQPa).toBeLessThan(40_000);
  });

  it('flies the suborbital test profile to apogee', () => {
    const s = simulateAscent(cfg(ref(), SUB), SIM_DT_S);
    expect(s.status).toBe('apogee');
    expect(s.maxAltitudeM).toBeGreaterThanOrEqual(100_000);
  });

  it('conserves propellant: never negative, monotonic decrease, mass consistent', () => {
    const c = cfg(ref());
    let s = initialAscentState(c.vehicle);
    let prevB = s.boosterPropKg;
    let prevS = s.shipPropKg;
    for (let i = 0; i < 8000 && s.status === 'flying'; i++) {
      s = stepAscent(s, c, SIM_DT_S);
      expect(s.boosterPropKg).toBeGreaterThanOrEqual(0);
      expect(s.shipPropKg).toBeGreaterThanOrEqual(0);
      expect(s.boosterPropKg).toBeLessThanOrEqual(prevB + 1e-6);
      expect(s.shipPropKg).toBeLessThanOrEqual(prevS + 1e-6);
      if (s.stage === 'booster') expect(s.shipPropKg).toBe(c.vehicle.ship.propellantKg);
      prevB = s.boosterPropKg;
      prevS = s.shipPropKg;
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = simulateAscent(cfg(ref()), SIM_DT_S);
    const b = simulateAscent(cfg(ref()), SIM_DT_S);
    expect(a).toEqual(b);
  });

  it('refuses to lift off when thrust is below weight', () => {
    const weak = strip(ref(), 'engine-sl', 6); // 6 engines left in total (booster + ship)
    const s = simulateAscent(cfg(weak), SIM_DT_S);
    expect(s.status).toBe('no-liftoff');
    expect(s.tS).toBe(0);
    expect(s.events[0]?.text).toMatch(/Hold-down abort/);
  });

  it('runs out of propellant when the payload is far too heavy', () => {
    const s = simulateAscent(cfg(ref(), ORBIT, 600_000), SIM_DT_S);
    expect(['out-of-propellant', 'no-liftoff', 'crashed']).toContain(s.status);
  });

  it('applies scheduled engine-outs and vehicle loss', () => {
    const c = cfg(ref());
    const out = simulateAscent(
      { ...c, failures: [{ atS: 30, kind: 'booster-engine-out' }] },
      SIM_DT_S,
    );
    expect(out.boosterEnginesOut).toBe(1);
    expect(out.status).toBe('orbit'); // 12 of 13 engines still get there
    const lost = simulateAscent({ ...c, failures: [{ atS: 60, kind: 'vehicle-loss' }] }, SIM_DT_S);
    expect(lost.status).toBe('lost');
    expect(lost.tS).toBeCloseTo(60, 0);
  });

  it('aborts on command and stays terminal', () => {
    const c = cfg(ref());
    let s = initialAscentState(c.vehicle);
    for (let i = 0; i < 400; i++) s = stepAscent(s, c, SIM_DT_S);
    const a = abortAscent(s, true);
    expect(a.status).toBe('aborted');
    expect(a.events.at(-1)?.text).toMatch(/Crew safe/);
    expect(stepAscent(a, c, SIM_DT_S)).toBe(a);
  });

  it('keeps acceleration within the guidance limit (plus margin)', () => {
    const c = cfg(ref());
    let s = initialAscentState(c.vehicle);
    let maxG = 0;
    for (let i = 0; i < 20000 && s.status === 'flying'; i++) {
      s = stepAscent(s, c, SIM_DT_S);
      maxG = Math.max(maxG, s.accelerationG);
    }
    expect(maxG).toBeLessThan(4.5);
    expect(G0_MS2).toBeGreaterThan(9.8);
  });
});

describe('failure planning', () => {
  it('is deterministic, disabled cleanly, and scales with risk', () => {
    expect(planFailures(1, 0.9, false)).toEqual([]);
    expect(planFailures(7, 0.5, true)).toEqual(planFailures(7, 0.5, true));
    let low = 0;
    let high = 0;
    for (let seed = 1; seed <= 400; seed++) {
      low += planFailures(seed, 0.1, true).length;
      high += planFailures(seed, 0.8, true).length;
    }
    expect(high).toBeGreaterThan(low * 3);
    for (const f of planFailures(3, 0.95, true)) expect(f.atS).toBeGreaterThan(0);
  });
});
