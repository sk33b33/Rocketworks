import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import type { Vec2 } from '../flight/orbitMath';
import { solveTransfer } from './kepler';
import {
  DAY_S,
  FIRST_WINDOW_DAY,
  MARS_INTERFACE_M,
  MARS_MU_M3S2,
  MARS_RADIUS_M,
  planetState,
  SUN_MU_M3S2,
  SYNODIC_S,
} from './solarSystem';

/*
 * Earth–Mars transfer planning with patched conics: a heliocentric transfer ellipse between the
 * planets' positions (solved for the departure time and a range of flight times), the hyperbolic
 * excess speeds it needs at both ends, and the burn from a low Earth parking orbit. Launch windows
 * are the departure days whose injection burn is within a margin of the best of the cycle.
 * Gameplay estimates for a circular, coplanar solar system.
 */

/** Parking orbit used for Mission Control's estimates (altitude, m). */
export const PARKING_ALT_M = 300_000;
export const MIN_TOF_DAYS = 140;
export const MAX_TOF_DAYS = 340;
/** Faster arrivals than this would make entry too hot (game limit, m/s). */
export const MAX_ARRIVAL_VINF_MS = 3_200;
/** A window is open while the injection burn is within this of the cycle's best (m/s). */
export const WINDOW_MARGIN_MS = 300;

export interface TransferOption {
  /** Departure program time (s). */
  readonly departT: number;
  readonly tofS: number;
  readonly arrivalT: number;
  /** Hyperbolic excess velocity leaving Earth and arriving at Mars (heliocentric, m/s). */
  readonly vInfDep: Vec2;
  readonly vInfArr: Vec2;
  readonly vInfDepMS: number;
  readonly vInfArrMS: number;
  /** Trans-Mars injection Δv from the parking orbit (impulsive estimate). */
  readonly tmiDvMS: number;
  /** Speed at the Mars entry interface. */
  readonly entrySpeedMS: number;
}

/** Injection burn from a circular orbit of radius `r` to leave Earth at `vInf` (m/s). */
export function tmiDeltaV(vInf: number, r = EARTH_RADIUS_M + PARKING_ALT_M): number {
  return Math.sqrt(vInf * vInf + (2 * EARTH_MU_M3S2) / r) - Math.sqrt(EARTH_MU_M3S2 / r);
}

export function entrySpeed(vInfArr: number): number {
  return Math.sqrt(vInfArr * vInfArr + (2 * MARS_MU_M3S2) / (MARS_RADIUS_M + MARS_INTERFACE_M));
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Transfer for a given departure time and flight time (null if unsolvable). */
export function transferFor(
  departT: number,
  tofS: number,
  parkingR = EARTH_RADIUS_M + PARKING_ALT_M,
  guess?: Vec2,
): (TransferOption & { readonly v1: Vec2 }) | null {
  const e = planetState('earth', departT);
  const m = planetState('mars', departT + tofS);
  const sol = solveTransfer(e.r, m.r, tofS, SUN_MU_M3S2, guess);
  if (!sol) return null;
  const vInfDep = sub(sol.v1, e.v);
  const vInfArr = sub(sol.v2, m.v);
  const vInfDepMS = Math.hypot(vInfDep[0], vInfDep[1]);
  const vInfArrMS = Math.hypot(vInfArr[0], vInfArr[1]);
  return {
    departT,
    tofS,
    arrivalT: departT + tofS,
    vInfDep,
    vInfArr,
    vInfDepMS,
    vInfArrMS,
    tmiDvMS: tmiDeltaV(vInfDepMS, parkingR),
    entrySpeedMS: entrySpeed(vInfArrMS),
    v1: sol.v1,
  };
}

/**
 * The cheapest transfer (smallest injection burn, arrival speed within limits) for a departure
 * time: a golden-section search over the flight time, warm-started along the way.
 */
export function bestTransfer(
  departT: number,
  parkingR = EARTH_RADIUS_M + PARKING_ALT_M,
): TransferOption | null {
  let guess: Vec2 | undefined;
  const cache = new Map<number, (TransferOption & { v1: Vec2 }) | null>();
  const evalTof = (days: number) => {
    const key = Math.round(days * 1_000);
    if (cache.has(key)) return cache.get(key)!;
    const t = transferFor(departT, days * DAY_S, parkingR, guess);
    if (t) guess = t.v1;
    cache.set(key, t);
    return t;
  };
  const cost = (days: number) => {
    const t = evalTof(days);
    if (!t) return Infinity;
    const over = Math.max(0, t.vInfArrMS - MAX_ARRIVAL_VINF_MS);
    return t.tmiDvMS + over * 3;
  };
  // Coarse scan first (the cost can have flat or broken stretches far from the window).
  let bestDays = MIN_TOF_DAYS;
  let bestCost = Infinity;
  for (let d = MIN_TOF_DAYS; d <= MAX_TOF_DAYS; d += 20) {
    const c = cost(d);
    if (c < bestCost) {
      bestCost = c;
      bestDays = d;
    }
  }
  if (!Number.isFinite(bestCost)) return null;
  let lo = Math.max(MIN_TOF_DAYS, bestDays - 20);
  let hi = Math.min(MAX_TOF_DAYS, bestDays + 20);
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = cost(x1);
  let f2 = cost(x2);
  for (let i = 0; i < 18; i++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = cost(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = cost(x2);
    }
  }
  const t = evalTof((lo + hi) / 2);
  if (!t) return null;
  const { v1: _v1, ...option } = t;
  void _v1;
  return option;
}

// ---- launch windows ----

/** Injection-burn profile over one synodic cycle, sampled every 2 days around the best day. */
interface WindowProfile {
  /** Offset (days) of the best departure from FIRST_WINDOW_DAY. */
  readonly bestOffsetDays: number;
  readonly bestDvMS: number;
  /** Window half-widths (days) before and after the best day. */
  readonly openBeforeDays: number;
  readonly openAfterDays: number;
}

let profileCache: WindowProfile | null = null;

/** The (periodic) window profile; computed once. */
export function windowProfile(): WindowProfile {
  if (profileCache) return profileCache;
  const samples: { off: number; dv: number }[] = [];
  for (let off = -90; off <= 90; off += 2) {
    const t = bestTransfer((FIRST_WINDOW_DAY + off) * DAY_S);
    samples.push({ off, dv: t ? t.tmiDvMS : Infinity });
  }
  let best = samples[0]!;
  for (const s of samples) if (s.dv < best.dv) best = s;
  const limit = best.dv + WINDOW_MARGIN_MS;
  let before = 0;
  let after = 0;
  for (const s of samples) {
    if (s.dv > limit) continue;
    before = Math.max(before, best.off - s.off);
    after = Math.max(after, s.off - best.off);
  }
  profileCache = {
    bestOffsetDays: best.off,
    bestDvMS: best.dv,
    openBeforeDays: before,
    openAfterDays: after,
  };
  return profileCache;
}

export interface WindowStatus {
  /** Program day this status is for. */
  readonly day: number;
  readonly open: boolean;
  /** Best departure day of the current (or next) window. */
  readonly bestDay: number;
  readonly opensDay: number;
  readonly closesDay: number;
  /** Days until the window opens (0 when open). */
  readonly opensInDays: number;
  /** Estimated injection burn and flight time for a departure today (null if unsolvable). */
  readonly today: TransferOption | null;
  /** The best departure of this window. */
  readonly bestDvMS: number;
}

const SYNODIC_DAYS = SYNODIC_S / DAY_S;

/** Window status for a program day. */
export function windowStatus(day: number): WindowStatus {
  const p = windowProfile();
  const firstBest = FIRST_WINDOW_DAY + p.bestOffsetDays;
  // The window that hasn't closed yet.
  let k = Math.ceil((day - firstBest - p.openAfterDays) / SYNODIC_DAYS);
  if (k < 0) k = 0;
  const bestDay = firstBest + k * SYNODIC_DAYS;
  const opensDay = bestDay - p.openBeforeDays;
  const closesDay = bestDay + p.openAfterDays;
  const open = day >= opensDay && day <= closesDay;
  return {
    day,
    open,
    bestDay,
    opensDay,
    closesDay,
    opensInDays: open ? 0 : Math.max(0, opensDay - day),
    today: open ? bestTransfer(day * DAY_S) : null,
    bestDvMS: p.bestDvMS,
  };
}
