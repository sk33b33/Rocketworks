import { hashString, mulberry32 } from '../shared/random';

/*
 * Surface EVA: one astronaut walks out from the landed ship to collect geology samples and
 * brings them back aboard before the suit's oxygen runs out. Positions are in the landing site's
 * terrain frame (x along the ground track, z across it, metres; the same frame the terrain patch
 * is drawn in). Walking, slopes, boulders and the oxygen budget are game values, not a suit
 * model. Pure and deterministic: the runtime feeds it inputs and real-time steps.
 */

export type EvaBody = 'moon' | 'mars';

/** The ground the astronaut walks on (SiteTerrain satisfies this). */
export interface EvaTerrain {
  heightAt(x: number, z?: number): number;
  boulderAt(x: number, z?: number): number;
}

export interface EvaRules {
  readonly body: EvaBody;
  /** Walking speed on level ground (m/s). */
  readonly walkMS: number;
  /** Suit oxygen for one EVA (s of real time). */
  readonly o2S: number;
  /** Samples on offer and how far from the ship they lie (m). */
  readonly samples: number;
  readonly minDistM: number;
  readonly maxDistM: number;
  /** Time to collect one sample, standing within `reachM` of it (s). */
  readonly collectS: number;
  readonly reachM: number;
  /** The astronaut can board within this distance of the ship (m). */
  readonly boardM: number;
  /** Safety limit: no walking farther than this from the ship (m). */
  readonly maxRangeM: number;
}

export const EVA_RULES: Record<EvaBody, EvaRules> = {
  moon: {
    body: 'moon',
    walkMS: 2.2,
    o2S: 420,
    samples: 3,
    minDistM: 35,
    maxDistM: 130,
    collectS: 4,
    reachM: 3,
    boardM: 12,
    maxRangeM: 300,
  },
  mars: {
    body: 'mars',
    walkMS: 1.8,
    o2S: 480,
    samples: 3,
    minDistM: 40,
    maxDistM: 150,
    collectS: 5,
    reachM: 3,
    boardM: 12,
    maxRangeM: 300,
  },
};

/** Where the astronaut steps off, from the ship's axis (clear of the hull and legs; m). */
export const EVA_HATCH_M = 10;
/** The ship's footprint (hull and legs) the astronaut can't walk through (m). */
export const EVA_SHIP_RADIUS_M = 5;
/** Keep-out radius around the ship's axis for the follow camera (m). */
export const SHIP_CLEARANCE_M = 7;
/** Turning rate while walking (rad/s). */
export const EVA_TURN_RAD_S = 1.6;
/** Boulders at least this big (m) block the way; smaller ones can be stepped over. */
export const EVA_BLOCKING_BOULDER_M = 0.7;
/** The terrain's boulder grid: at most one boulder per cell, at its centre (as drawn). */
export const BOULDER_CELL_M = 8;

/** Whether a boulder big enough to block stands at (x, z) (its drawn size, plus the suit). */
export function boulderBlocks(t: EvaTerrain, x: number, z: number): boolean {
  const cx = (Math.floor(x / BOULDER_CELL_M) + 0.5) * BOULDER_CELL_M;
  const cz = (Math.floor(z / BOULDER_CELL_M) + 0.5) * BOULDER_CELL_M;
  const size = t.boulderAt(cx, cz);
  return size >= EVA_BLOCKING_BOULDER_M && Math.hypot(x - cx, z - cz) < size * 0.85 + 0.35;
}
/** The low-oxygen warning comes at this fraction of the budget. */
export const EVA_LOW_O2 = 0.25;

export interface EvaSample {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** Collection progress 0..1 (1 = in the bag). */
  readonly progress: number;
}

export type EvaPhase = 'out' | 'aboard' | 'aborted';

export interface EvaState {
  readonly body: EvaBody;
  readonly phase: EvaPhase;
  readonly x: number;
  readonly z: number;
  /** Heading in the terrain frame (rad; 0 = +x, π/2 = +z). */
  readonly heading: number;
  /** Walking right now (for the animation). */
  readonly moving: boolean;
  readonly o2S: number;
  readonly elapsedS: number;
  /** Where the ship stands. */
  readonly shipX: number;
  readonly shipZ: number;
  readonly samples: readonly EvaSample[];
  readonly lowO2Warned: boolean;
}

export interface EvaInput {
  /** -1..1: back / forward. */
  readonly walk: number;
  /** -1..1: right / left (positive turns toward +z... counter-clockwise seen from above). */
  readonly turn: number;
  /** Collecting (held). */
  readonly collect: boolean;
}

export const NO_EVA_INPUT: EvaInput = { walk: 0, turn: 0, collect: false };

const NAMES: Record<EvaBody, readonly string[]> = {
  moon: ['Basalt chip', 'Anorthosite fragment', 'Regolith core', 'Impact breccia', 'Glass bead'],
  mars: ['Ice-rich core', 'Basalt cobble', 'Sulfate crust', 'Dust sample', 'Layered sediment'],
};

const slopeAt = (t: EvaTerrain, x: number, z: number) => {
  const d = 2;
  return Math.hypot(
    (t.heightAt(x + d, z) - t.heightAt(x - d, z)) / (2 * d),
    (t.heightAt(x, z + d) - t.heightAt(x, z - d)) / (2 * d),
  );
};

/**
 * Sample sites around the ship, the same for a given site seed every time (so a second EVA finds
 * the ones not yet taken). Each sits on walkable ground, clear of boulders.
 */
export function placeSamples(
  rules: EvaRules,
  terrain: EvaTerrain,
  seedKey: string,
  shipX: number,
  shipZ = 0,
): EvaSample[] {
  const rnd = mulberry32(hashString(`eva:${rules.body}:${seedKey}`));
  const names = NAMES[rules.body];
  const out: EvaSample[] = [];
  for (let i = 0; i < rules.samples; i++) {
    const base = (i / rules.samples) * Math.PI * 2 + rnd() * 1.2;
    let best: { x: number; z: number } | null = null;
    // Near the planned bearing first, then anywhere around the ship.
    for (let tries = 0; tries < 60 && !best; tries++) {
      const a = tries === 0 ? base : tries < 24 ? base + (rnd() - 0.5) * 1.5 : rnd() * Math.PI * 2;
      const d = rules.minDistM + rnd() * (rules.maxDistM - rules.minDistM);
      const x = shipX + Math.cos(a) * d;
      const z = shipZ + Math.sin(a) * d;
      if (!boulderBlocks(terrain, x, z) && slopeAt(terrain, x, z) < 0.35) best = { x, z };
    }
    const p = best ?? {
      x: shipX + Math.cos(base) * rules.minDistM,
      z: shipZ + Math.sin(base) * rules.minDistM,
    };
    out.push({ id: `s${i + 1}`, name: names[i % names.length]!, x: p.x, z: p.z, progress: 0 });
  }
  return out;
}

/**
 * A new EVA from the ship's hatch. Samples whose ids are in `taken` were brought back on an
 * earlier EVA and stay collected.
 */
export function startEva(
  rules: EvaRules,
  terrain: EvaTerrain,
  seedKey: string,
  shipX: number,
  taken: readonly string[] = [],
): EvaState {
  const samples = placeSamples(rules, terrain, seedKey, shipX).map((s) =>
    taken.includes(s.id) ? { ...s, progress: 1 } : s,
  );
  // Step off on the side facing the nearest sample still out there.
  const open = samples.filter((s) => s.progress < 1);
  const first = open.length
    ? open.reduce((a, b) => (dist(a, shipX, 0) <= dist(b, shipX, 0) ? a : b))
    : null;
  const heading = first ? Math.atan2(first.z, first.x - shipX) : 0;
  return {
    body: rules.body,
    phase: 'out',
    x: shipX + Math.cos(heading) * EVA_HATCH_M,
    z: Math.sin(heading) * EVA_HATCH_M,
    heading,
    moving: false,
    o2S: rules.o2S,
    elapsedS: 0,
    shipX,
    shipZ: 0,
    samples,
    lowO2Warned: false,
  };
}

const dist = (p: { x: number; z: number }, x: number, z: number) => Math.hypot(p.x - x, p.z - z);

export interface EvaStep {
  readonly state: EvaState;
  /** Something worth telling the player (a sample bagged, low oxygen, a boulder, the limit). */
  readonly note: string | null;
}

/** Advances the EVA by `dtS` of real time. Pure. */
export function stepEva(
  st: EvaState,
  input: EvaInput,
  dtS: number,
  rules: EvaRules,
  terrain: EvaTerrain,
): EvaStep {
  if (st.phase !== 'out' || dtS <= 0) return { state: st, note: null };
  let note: string | null = null;
  const o2S = Math.max(0, st.o2S - dtS);
  if (o2S <= 0) {
    return {
      state: { ...st, o2S: 0, phase: 'aborted', moving: false, elapsedS: st.elapsedS + dtS },
      note: 'Suit oxygen exhausted: the crew hauled the astronaut back aboard. The samples were dropped.',
    };
  }
  let lowO2Warned = st.lowO2Warned;
  if (!lowO2Warned && o2S <= rules.o2S * EVA_LOW_O2) {
    lowO2Warned = true;
    note = 'Oxygen low: head back to the ship.';
  }

  const heading = st.heading + clamp(input.turn, -1, 1) * EVA_TURN_RAD_S * dtS;
  let { x, z } = st;
  let moving = false;
  const walk = clamp(input.walk, -1, 1);
  const collecting = input.collect && nearestOpen(st, rules.reachM) !== null;
  if (walk !== 0 && !collecting) {
    const dir = Math.sign(walk);
    const dx = Math.cos(heading) * dir;
    const dz = Math.sin(heading) * dir;
    // Uphill is slower, downhill a little faster; steep ground is impassable.
    const grade = (terrain.heightAt(x + dx, z + dz) - terrain.heightAt(x, z)) / 1;
    const factor = grade > 0.6 ? 0 : clamp(1 - grade * 1.6, 0.3, 1.15);
    const speed = rules.walkMS * Math.abs(walk) * (walk < 0 ? 0.5 : 1) * factor;
    const nx = x + dx * speed * dtS;
    const nz = z + dz * speed * dtS;
    if (factor === 0) note ??= 'Too steep to climb here.';
    else if (boulderBlocks(terrain, nx, nz)) note ??= 'A boulder is in the way.';
    else if (
      Math.hypot(nx - st.shipX, nz - st.shipZ) < EVA_SHIP_RADIUS_M &&
      Math.hypot(nx - st.shipX, nz - st.shipZ) < Math.hypot(x - st.shipX, z - st.shipZ)
    )
      note ??= 'The ship is in the way.';
    else if (Math.hypot(nx - st.shipX, nz - st.shipZ) > rules.maxRangeM)
      note ??= `Safety limit: stay within ${rules.maxRangeM} m of the ship.`;
    else {
      x = nx;
      z = nz;
      moving = true;
    }
  }

  let samples = st.samples;
  if (collecting) {
    const target = nearestOpen(st, rules.reachM)!;
    const progress = Math.min(1, target.progress + dtS / rules.collectS);
    samples = samples.map((s) => (s.id === target.id ? { ...s, progress } : s));
    if (progress >= 1) note = `${target.name} bagged.`;
  }
  return {
    state: {
      ...st,
      x,
      z,
      heading: wrap(heading),
      moving,
      o2S,
      elapsedS: st.elapsedS + dtS,
      samples,
      lowO2Warned,
    },
    note,
  };
}

/** The nearest sample not yet bagged within `withinM` (null if none). */
export function nearestOpen(st: EvaState, withinM = Infinity): EvaSample | null {
  let best: EvaSample | null = null;
  let bd = withinM;
  for (const s of st.samples) {
    if (s.progress >= 1) continue;
    const d = dist(s, st.x, st.z);
    if (d <= bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Whether the astronaut can climb back aboard now, with a reason if not. */
export function canBoard(st: EvaState, rules: EvaRules): { ok: boolean; reason?: string } {
  if (st.phase !== 'out') return { ok: false, reason: 'No one is outside.' };
  const d = Math.hypot(st.x - st.shipX, st.z - st.shipZ);
  if (d > rules.boardM)
    return { ok: false, reason: `Walk back to the ship first (${Math.round(d)} m away).` };
  return { ok: true };
}

/** Climbs back aboard: the bagged samples count from now on. */
export function boardShip(st: EvaState): EvaState {
  return { ...st, phase: 'aboard', moving: false };
}

/** Ids of the samples brought aboard by a finished EVA (none if it was aborted). */
export function returnedSamples(st: EvaState): string[] {
  if (st.phase !== 'aboard') return [];
  return st.samples.filter((s) => s.progress >= 1).map((s) => s.id);
}

/** Where something is relative to the astronaut: distance and a clock-style direction. */
export function bearingTo(st: EvaState, x: number, z: number): { distM: number; dir: string } {
  const distM = Math.hypot(x - st.x, z - st.z);
  if (distM < 1) return { distM, dir: 'here' };
  const rel = wrap(Math.atan2(z - st.z, x - st.x) - st.heading);
  const deg = (rel * 180) / Math.PI;
  const a = Math.abs(deg);
  const side = deg > 0 ? 'left' : 'right';
  const dir =
    a < 20
      ? 'ahead'
      : a < 70
        ? `ahead ${side}`
        : a < 110
          ? side
          : a < 160
            ? `behind ${side}`
            : 'behind';
  return { distM, dir };
}

/** The EVA's tally for the flight record. */
export interface EvaSummary {
  readonly body: EvaBody;
  /** Samples brought aboard (all EVAs of the flight). */
  readonly samples: number;
  readonly total: number;
  /** EVAs finished by boarding, and those ended by running out of oxygen. */
  readonly walks: number;
  readonly aborted: number;
  /** Ids of the samples aboard (so a later EVA leaves them collected). */
  readonly taken: readonly string[];
}

/** Adds a finished EVA to the flight's tally. Pure. */
export function tallyEva(prev: EvaSummary | undefined, st: EvaState, rules: EvaRules): EvaSummary {
  const taken = [...new Set([...(prev?.taken ?? []), ...returnedSamples(st)])];
  return {
    body: st.body,
    samples: taken.length,
    total: rules.samples,
    walks: (prev?.walks ?? 0) + (st.phase === 'aboard' ? 1 : 0),
    aborted: (prev?.aborted ?? 0) + (st.phase === 'aborted' ? 1 : 0),
    taken,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
