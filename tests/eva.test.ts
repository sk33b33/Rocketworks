import { describe, expect, it } from 'vitest';
import {
  bearingTo,
  boulderBlocks,
  boardShip,
  canBoard,
  EVA_LOW_O2,
  EVA_RULES,
  nearestOpen,
  NO_EVA_INPUT,
  placeSamples,
  returnedSamples,
  startEva,
  stepEva,
  tallyEva,
  type EvaState,
  type EvaTerrain,
} from '../src/surface/eva';
import { newlyAchieved } from '../src/progression/milestones';
import type { FlightRecord } from '../src/launch/flightRecord';
import { collectAll } from './evaHelpers';
import type { EvaKey } from '../src/flight/flightRuntime';

const FLAT: EvaTerrain = { heightAt: () => 0, boulderAt: () => 0 };
const MOON = EVA_RULES.moon;

/** A tiny driver around the pure functions, like the runtime. */
function driver(terrain: EvaTerrain, st: EvaState) {
  const keys = new Set<EvaKey>();
  const d = {
    st,
    get evaState() {
      return d.st;
    },
    setEvaKey(k: EvaKey, down: boolean) {
      if (down) keys.add(k);
      else keys.delete(k);
    },
    update(dt: number) {
      d.st = stepEva(
        d.st,
        {
          walk: (keys.has('forward') ? 1 : 0) - (keys.has('back') ? 1 : 0),
          turn: (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0),
          collect: keys.has('collect'),
        },
        dt,
        MOON,
        terrain,
      ).state;
    },
  };
  return d;
}

describe('EVA', () => {
  it('places the same samples for a site every time, on walkable ground at a walk away', () => {
    const a = placeSamples(MOON, FLAT, 'sea-of-calm', 12);
    expect(a).toEqual(placeSamples(MOON, FLAT, 'sea-of-calm', 12));
    expect(a).not.toEqual(placeSamples(MOON, FLAT, 'aurora-highlands', 12));
    expect(a).toHaveLength(MOON.samples);
    for (const s of a) {
      const d = Math.hypot(s.x - 12, s.z);
      expect(d).toBeGreaterThanOrEqual(MOON.minDistM - 1e-9);
      expect(d).toBeLessThanOrEqual(MOON.maxDistM + 1e-9);
    }
    // Boulders under a candidate push the sample elsewhere.
    const rocky: EvaTerrain = { heightAt: () => 0, boulderAt: (x) => (x > 12 ? 2 : 0) };
    for (const s of placeSamples(MOON, rocky, 'sea-of-calm', 12))
      expect(boulderBlocks(rocky, s.x, s.z)).toBe(false);
  });

  it('walks, turns, slows uphill and stops at boulders, steep ground and the safety limit', () => {
    const st = { ...startEva(MOON, FLAT, 'x', 0), heading: 0, x: 0, z: 0 };
    const walk = stepEva(st, { walk: 1, turn: 0, collect: false }, 1, MOON, FLAT).state;
    expect(walk.x).toBeCloseTo(MOON.walkMS);
    expect(walk.moving).toBe(true);
    const turned = stepEva(st, { walk: 0, turn: 1, collect: false }, 0.5, MOON, FLAT).state;
    expect(turned.heading).toBeGreaterThan(0);
    const hill: EvaTerrain = { heightAt: (x) => x * 0.3, boulderAt: () => 0 };
    const up = stepEva(st, { walk: 1, turn: 0, collect: false }, 1, MOON, hill).state;
    expect(up.x).toBeGreaterThan(0);
    expect(up.x).toBeLessThan(walk.x);
    const cliff: EvaTerrain = { heightAt: (x) => x * 2, boulderAt: () => 0 };
    const blocked = stepEva(st, { walk: 1, turn: 0, collect: false }, 1, MOON, cliff);
    expect(blocked.state.x).toBe(0);
    expect(blocked.note).toMatch(/steep/);
    // A 1.5 m boulder at the centre of its 8 m cell (4, 4) blocks only near it.
    const rock: EvaTerrain = { heightAt: () => 0, boulderAt: () => 1.5 };
    const near = { ...st, x: 1.5, z: 4 };
    const stopped = stepEva(near, { walk: 1, turn: 0, collect: false }, 0.5, MOON, rock);
    expect(stopped.state.x).toBe(1.5);
    const beside = { ...st, x: 1.5, z: 0.5 };
    expect(stepEva(beside, { walk: 1, turn: 0, collect: false }, 0.5, MOON, rock).state.x).toBe(
      1.5 + MOON.walkMS * 0.5,
    );
    expect(stopped.note).toMatch(/boulder/);
    // The ship's hull is solid too.
    const atHull = { ...st, shipX: 6, x: 0.5, z: 0 };
    const bump = stepEva(atHull, { walk: 1, turn: 0, collect: false }, 0.5, MOON, FLAT);
    expect(bump.state.x).toBe(0.5);
    expect(bump.note).toMatch(/ship/);
    const far = { ...st, x: MOON.maxRangeM - 0.5 };
    expect(stepEva(far, { walk: 1, turn: 0, collect: false }, 1, MOON, FLAT).note).toMatch(
      /Safety/,
    );
  });

  it('collects within reach only, warns on low oxygen and aborts when it runs out', () => {
    const st = startEva(MOON, FLAT, 'site', 0);
    const target = st.samples[0]!;
    // Out of reach: collecting does nothing.
    const far = stepEva(st, { walk: 0, turn: 0, collect: true }, 1, MOON, FLAT).state;
    expect(far.samples.every((s) => s.progress === 0)).toBe(true);
    let at: EvaState = { ...st, x: target.x + 1, z: target.z };
    expect(nearestOpen(at, MOON.reachM)?.id).toBe(target.id);
    // Collecting holds the astronaut still.
    const held = stepEva(at, { walk: 1, turn: 0, collect: true }, 0.1, MOON, FLAT).state;
    expect(held.x).toBe(at.x);
    let note: string | null = null;
    for (let i = 0; i < 50; i++) {
      const r = stepEva(at, { walk: 0, turn: 0, collect: true }, 0.1, MOON, FLAT);
      at = r.state;
      note = r.note ?? note;
    }
    expect(at.samples.find((s) => s.id === target.id)?.progress).toBe(1);
    expect(note).toMatch(/bagged/);

    const low = stepEva({ ...st, o2S: MOON.o2S * EVA_LOW_O2 + 0.5 }, NO_EVA_INPUT, 1, MOON, FLAT);
    expect(low.note).toMatch(/Oxygen low/);
    expect(low.state.lowO2Warned).toBe(true);
    const out = stepEva({ ...at, o2S: 0.5 }, NO_EVA_INPUT, 1, MOON, FLAT);
    expect(out.state.phase).toBe('aborted');
    expect(returnedSamples(out.state)).toEqual([]);
    expect(tallyEva(undefined, out.state, MOON)).toMatchObject({
      samples: 0,
      aborted: 1,
      walks: 0,
    });
  });

  it('boards only near the ship, and counts the samples brought aboard', () => {
    const st = startEva(MOON, FLAT, 'site', 10);
    expect(canBoard(st, MOON).ok).toBe(true);
    const away = { ...st, x: 60 };
    expect(canBoard(away, MOON).reason).toMatch(/Walk back/);
    const bagged = {
      ...st,
      samples: st.samples.map((s, i) => (i === 0 ? { ...s, progress: 1 } : s)),
    };
    const first = tallyEva(undefined, boardShip(bagged), MOON);
    expect(first).toMatchObject({ samples: 1, total: 3, walks: 1, taken: ['s1'] });
    // A second EVA finds the first sample already taken.
    const again = startEva(MOON, FLAT, 'site', 10, first.taken);
    expect(again.samples[0]!.progress).toBe(1);
    expect(nearestOpen(again)?.id).not.toBe('s1');
  });

  it('describes where things are relative to the heading', () => {
    const st = { ...startEva(MOON, FLAT, 'x', 0), x: 0, z: 0, heading: 0 };
    expect(bearingTo(st, 10, 0).dir).toBe('ahead');
    expect(bearingTo(st, 0, 10).dir).toBe('left');
    expect(bearingTo(st, 0, -10).dir).toBe('right');
    expect(bearingTo(st, -10, 0).dir).toBe('behind');
    expect(bearingTo(st, 0, 0).dir).toBe('here');
  });

  it('can be walked by a player to all samples and back', () => {
    const d = driver(FLAT, startEva(MOON, FLAT, 'sea-of-calm', 0));
    collectAll(d, MOON.reachM, MOON.boardM);
    expect(d.st.samples.every((s) => s.progress >= 1)).toBe(true);
    expect(canBoard(d.st, MOON).ok).toBe(true);
    expect(d.st.o2S).toBeGreaterThan(0);
  });

  it('awards the EVA milestones only with samples aboard and the crew safe', () => {
    const flight = (eva: FlightRecord['eva'], crewSafe = true) =>
      ({ crewSafe, eva }) as unknown as FlightRecord;
    const ids = (f: FlightRecord) =>
      newlyAchieved([], { blueprints: [], flights: [f] }).map((m) => m.id);
    expect(ids(flight({ body: 'moon', samples: 1, total: 3, walks: 1, aborted: 0 }))).toEqual([
      'moonwalk',
    ]);
    expect(ids(flight({ body: 'moon', samples: 3, total: 3, walks: 1, aborted: 0 }))).toEqual([
      'moonwalk',
      'lunar-geologist',
    ]);
    expect(ids(flight({ body: 'mars', samples: 3, total: 3, walks: 2, aborted: 0 }))).toEqual([
      'marswalk',
      'mars-geologist',
    ]);
    expect(ids(flight({ body: 'moon', samples: 0, total: 3, walks: 0, aborted: 1 }))).toEqual([]);
    expect(
      ids(flight({ body: 'moon', samples: 3, total: 3, walks: 1, aborted: 0 }, false)),
    ).toEqual([]);
  });
});
