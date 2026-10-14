import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import { wrapAngle, type Vec2 } from '../flight/orbitMath';
import { solveTransfer } from './kepler';
import {
  DAY_S,
  FIRST_WINDOW_DAY,
  HOHMANN_TOF_S,
  MARS_INTERFACE_M,
  MARS_MU_M3S2,
  MARS_RADIUS_M,
  PLANETS,
  planetState,
  SUN_MU_M3S2,
  SYNODIC_S,
  type Planet,
} from './solarSystem';

/*
 * Earth–Mars transfer planning with patched conics, in either direction: a heliocentric transfer
 * ellipse between the planets' positions (solved for the departure time and a range of flight
 * times), the hyperbolic excess speeds it needs at both ends, and the injection burn from a low
 * parking orbit around the departure planet. Windows are the departure days whose injection burn
 * is within a margin of the best of the cycle. Gameplay estimates for a circular, coplanar solar
 * system.
 */

/** Parking orbit used for Mission Control's estimates (altitude, m). */
export const PARKING_ALT_M = 300_000;
/** Low Mars orbit the crew departs from (altitude, m). */
export const MARS_PARKING_ALT_M = 200_000;
/** Minimum-energy flight time between the planets (days). */
export const HOHMANN_DAYS = HOHMANN_TOF_S / DAY_S;
export const MIN_TOF_DAYS = 140;
export const MAX_TOF_DAYS = 340;
/** Faster arrivals than this would make entry too hot (game limit, m/s). */
export const MAX_ARRIVAL_VINF_MS = 3_200;
/** Faster returns than this would overheat the aerocapture at Earth (game limit, m/s). */
export const MAX_RETURN_VINF_MS = 4_500;
/** A window is open while the injection burn is within this of the cycle's best (m/s). */
export const WINDOW_MARGIN_MS = 300;
/** Earth's entry interface used for arrival speeds (altitude, m). */
const EARTH_INTERFACE_M = 120_000;

/** Direction of a transfer: out to Mars, or home to Earth. */
export type Leg = 'out' | 'home';

interface LegSpec {
  readonly from: Planet;
  readonly to: Planet;
  readonly departMu: number;
  readonly parkingR: number;
  readonly arriveMu: number;
  readonly interfaceR: number;
  readonly maxArrivalVinf: number;
}

const LEGS: Record<Leg, LegSpec> = {
  out: {
    from: 'earth',
    to: 'mars',
    departMu: EARTH_MU_M3S2,
    parkingR: EARTH_RADIUS_M + PARKING_ALT_M,
    arriveMu: MARS_MU_M3S2,
    interfaceR: MARS_RADIUS_M + MARS_INTERFACE_M,
    maxArrivalVinf: MAX_ARRIVAL_VINF_MS,
  },
  home: {
    from: 'mars',
    to: 'earth',
    departMu: MARS_MU_M3S2,
    parkingR: MARS_RADIUS_M + MARS_PARKING_ALT_M,
    arriveMu: EARTH_MU_M3S2,
    interfaceR: EARTH_RADIUS_M + EARTH_INTERFACE_M,
    maxArrivalVinf: MAX_RETURN_VINF_MS,
  },
};

/** Default parking-orbit radius around a leg's departure planet. */
export const parkingRadius = (leg: Leg): number => LEGS[leg].parkingR;

export interface TransferOption {
  /** Departure program time (s). */
  readonly departT: number;
  readonly tofS: number;
  readonly arrivalT: number;
  /** Hyperbolic excess velocity leaving and arriving (heliocentric, m/s). */
  readonly vInfDep: Vec2;
  readonly vInfArr: Vec2;
  readonly vInfDepMS: number;
  readonly vInfArrMS: number;
  /** Injection Δv from the departure planet's parking orbit (impulsive estimate). */
  readonly tmiDvMS: number;
  /** Speed at the arrival planet's entry interface. */
  readonly entrySpeedMS: number;
}

/** Injection burn from a circular orbit of radius `r` to leave a planet at `vInf` (m/s). */
export function tmiDeltaV(
  vInf: number,
  r = EARTH_RADIUS_M + PARKING_ALT_M,
  mu = EARTH_MU_M3S2,
): number {
  return Math.sqrt(vInf * vInf + (2 * mu) / r) - Math.sqrt(mu / r);
}

/** Speed at the entry interface for an arrival at `vInfArr` (Mars by default). */
export function entrySpeed(vInfArr: number, leg: Leg = 'out'): number {
  const l = LEGS[leg];
  return Math.sqrt(vInfArr * vInfArr + (2 * l.arriveMu) / l.interfaceR);
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Transfer for a given departure time and flight time (null if unsolvable). */
export function transferFor(
  departT: number,
  tofS: number,
  parkingR?: number,
  guess?: Vec2,
  leg: Leg = 'out',
): (TransferOption & { readonly v1: Vec2 }) | null {
  const l = LEGS[leg];
  const e = planetState(l.from, departT);
  const m = planetState(l.to, departT + tofS);
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
    tmiDvMS: tmiDeltaV(vInfDepMS, parkingR ?? l.parkingR, l.departMu),
    entrySpeedMS: entrySpeed(vInfArrMS, leg),
    v1: sol.v1,
  };
}

/**
 * The cheapest transfer (smallest injection burn, arrival speed within limits) for a departure
 * time: a golden-section search over the flight time, warm-started along the way.
 */
export function bestTransfer(
  departT: number,
  parkingR?: number,
  leg: Leg = 'out',
): TransferOption | null {
  const maxArr = LEGS[leg].maxArrivalVinf;
  let guess: Vec2 | undefined;
  const cache = new Map<number, (TransferOption & { v1: Vec2 }) | null>();
  const evalTof = (days: number) => {
    const key = Math.round(days * 1_000);
    if (cache.has(key)) return cache.get(key)!;
    const t = transferFor(departT, days * DAY_S, parkingR, guess, leg);
    if (t) guess = t.v1;
    cache.set(key, t);
    return t;
  };
  const cost = (days: number) => {
    const t = evalTof(days);
    if (!t) return Infinity;
    const over = Math.max(0, t.vInfArrMS - maxArr);
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
  /** Offset (days) of the best departure from the leg's reference day. */
  readonly bestOffsetDays: number;
  readonly bestDvMS: number;
  /** Window half-widths (days) before and after the best day. */
  readonly openBeforeDays: number;
  readonly openAfterDays: number;
}

const profileCache: Partial<Record<Leg, WindowProfile>> = {};

/**
 * Program day of a leg's first minimum-energy (Hohmann) departure: day FIRST_WINDOW_DAY for the
 * way out, and the first return opportunity after it for the way home.
 */
export function referenceDay(leg: Leg): number {
  if (leg === 'out') return FIRST_WINDOW_DAY;
  const e = PLANETS.earth;
  const m = PLANETS.mars;
  // Earth must reach the point opposite Mars's departure one Hohmann flight time later.
  const want = e.n * HOHMANN_TOF_S - Math.PI;
  const rate = m.n - e.n;
  const t0 = FIRST_WINDOW_DAY * DAY_S;
  const now = m.angle0 - e.angle0 + rate * t0;
  // The phase falls over time (Earth gains on Mars): time until it next equals `want`.
  let d = wrapAngle(now - want);
  if (d < 0) d += 2 * Math.PI;
  return (t0 + d / -rate) / DAY_S;
}

/** The (periodic) window profile of a leg; computed once. */
export function windowProfile(leg: Leg = 'out'): WindowProfile {
  const cached = profileCache[leg];
  if (cached) return cached;
  const ref = referenceDay(leg);
  const samples: { off: number; dv: number }[] = [];
  for (let off = -90; off <= 90; off += 2) {
    const t = bestTransfer((ref + off) * DAY_S, undefined, leg);
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
  const profile: WindowProfile = {
    bestOffsetDays: best.off,
    bestDvMS: best.dv,
    openBeforeDays: before,
    openAfterDays: after,
  };
  profileCache[leg] = profile;
  return profile;
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

/** Window status for a program day (launch windows out, or return windows home). */
export function windowStatus(day: number, leg: Leg = 'out'): WindowStatus {
  const p = windowProfile(leg);
  const firstBest = referenceDay(leg) + p.bestOffsetDays;
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
    today: open ? bestTransfer(day * DAY_S, undefined, leg) : null,
    bestDvMS: p.bestDvMS,
  };
}
