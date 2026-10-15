import { hashString, mulberry32 } from '../shared/random';
import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import { PARKING_ORBIT_ALTITUDE_M } from '../launch/missionProfile';
import { windowStatus } from '../mars/marsTransfer';
import { STARTING_TREASURY_CREDITS, grantsBetween, periodOf, PERIOD_DAYS } from './treasury';

/*
 * Contracts: paid flights for fictional clients, offered on a board in Mission Control. Each one
 * is a variant of a flight the program already knows how to fly (a satellite to a requested
 * orbit, a station resupply run, cargo for the lunar depot, a tanker run to the Mars plant), with
 * a payout, a deadline on the program calendar and a reputation stake. The board is generated
 * from a seed per 30-day period, so it is the same on every reload. Pure functions; game values.
 */

export type ContractKind = 'satellite' | 'resupply' | 'lunar-depot' | 'mars-tanker';

/** The (hidden) mission each kind of contract is flown as. */
export const CONTRACT_MISSION: Record<ContractKind, string> = {
  satellite: 'contract-satellite',
  resupply: 'contract-resupply',
  'lunar-depot': 'contract-lunar-depot',
  'mars-tanker': 'contract-mars-tanker',
};

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  satellite: 'Satellite deployment',
  resupply: 'Station resupply',
  'lunar-depot': 'Lunar depot cargo',
  'mars-tanker': 'Mars tanker run',
};

/** Story mission that must be flown before a kind of contract is offered. */
const UNLOCKED_BY: Record<ContractKind, string> = {
  satellite: 'orbital-flight',
  resupply: 'station-docking',
  'lunar-depot': 'lunar-landing',
  'mars-tanker': 'mars-cargo',
};

export interface Contract {
  readonly id: string;
  readonly kind: ContractKind;
  readonly client: string;
  readonly title: string;
  readonly payloadId: string;
  /** Satellite deployments: the requested circular orbit (km) and tolerance on both apsides. */
  readonly targetAltKm: number | null;
  readonly toleranceKm: number;
  readonly payout: number;
  readonly repReward: number;
  readonly repPenalty: number;
  /** Days from acceptance to the deadline. */
  readonly deadlineDays: number;
  /** Premium clients only deal with programs of this reputation (0 = anyone). */
  readonly minReputation: number;
}

export interface ActiveContract extends Contract {
  readonly acceptedDay: number;
  readonly deadlineDay: number;
}

export type ContractResult = 'paid' | 'failed' | 'late' | 'expired' | 'cancelled';

export interface ContractOutcome {
  readonly id: string;
  readonly title: string;
  readonly client: string;
  readonly result: ContractResult;
  readonly payout: number;
  readonly day: number;
}

/** Everything the program's economy keeps between sessions. */
export interface EconomyState {
  readonly treasury: number;
  /** 0..100; starts at 20. Raises payouts and opens premium clients. */
  readonly reputation: number;
  readonly board: { readonly period: number; readonly offers: readonly Contract[] };
  readonly active: ActiveContract | null;
  /** Most recent last (kept short). */
  readonly history: readonly ContractOutcome[];
}

export const STARTING_REPUTATION = 20;
const MAX_HISTORY = 12;
const OFFERS_PER_BOARD = 4;

export function initialEconomy(treasury = STARTING_TREASURY_CREDITS): EconomyState {
  return {
    treasury,
    reputation: STARTING_REPUTATION,
    board: { period: -1, offers: [] },
    active: null,
    history: [],
  };
}

/** Program facts the board depends on. */
export interface BoardContext {
  readonly completedMissionIds: readonly string[];
  readonly hasMarsBase: boolean;
}

export function contractKindsAvailable(ctx: BoardContext): ContractKind[] {
  return (Object.keys(UNLOCKED_BY) as ContractKind[]).filter(
    (k) =>
      ctx.completedMissionIds.includes(UNLOCKED_BY[k]) && (k !== 'mars-tanker' || ctx.hasMarsBase),
  );
}

/** Payout multiplier for a reputation (1× at 0, 1.5× at 100). */
export const reputationFactor = (rep: number): number => 1 + Math.max(0, Math.min(100, rep)) / 200;

const SAT_PAYLOADS = [
  { id: 'weather-sat', name: 'weather satellite', tons: 6 },
  { id: 'nav-sat', name: 'navigation satellite', tons: 9 },
  { id: 'comms-sat', name: 'relay communications satellite', tons: 12 },
] as const;

const CLIENTS: Record<ContractKind, readonly string[]> = {
  satellite: [
    'Northline Telecom',
    'Polar Weather Service',
    'Meridian Navigation',
    'Aurora Science Consortium',
  ],
  resupply: ['Orbital Station Partners', 'Low Orbit Research Office'],
  'lunar-depot': ['Selene Logistics', 'Cislunar Freight Co.'],
  'mars-tanker': ['Red Dust Holdings', 'Ares Fuel Cooperative'],
};

const round5k = (n: number) => Math.round(n / 5_000) * 5_000;

/** One offer from the board's random stream. */
function makeOffer(
  kind: ContractKind,
  rand: () => number,
  id: string,
  day: number,
  reputation: number,
): Contract {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const client = pick(CLIENTS[kind]);
  const premium = rand() < 0.3;
  const minReputation = premium ? (rand() < 0.5 ? 40 : 60) : 0;
  const boost = (premium ? 1.3 : 1) * reputationFactor(reputation);
  const base = {
    id,
    kind,
    client,
    targetAltKm: null as number | null,
    toleranceKm: 0,
    minReputation,
  };
  switch (kind) {
    case 'satellite': {
      const sat = pick(SAT_PAYLOADS);
      const alt = 300 + Math.round(rand() * 18) * 50; // 300–1,200 km
      return {
        ...base,
        title: `Deploy a ${sat.name} to a ${alt} km orbit`,
        payloadId: sat.id,
        targetAltKm: alt,
        toleranceKm: 50,
        payout: round5k((50_000 + sat.tons * 4_000 + alt * 60) * boost),
        repReward: 5,
        repPenalty: 8,
        deadlineDays: 45 + Math.round(rand() * 3) * 15,
      };
    }
    case 'resupply':
      return {
        ...base,
        title: 'Deliver a resupply module to the orbital station',
        payloadId: 'station-supplies',
        payout: round5k(150_000 * boost),
        repReward: 6,
        repPenalty: 10,
        deadlineDays: 60 + Math.round(rand() * 2) * 15,
      };
    case 'lunar-depot':
      return {
        ...base,
        title: 'Deliver a cargo pallet to the lunar depot',
        payloadId: 'depot-cargo',
        payout: round5k(320_000 * boost),
        repReward: 8,
        repPenalty: 12,
        deadlineDays: 90,
      };
    case 'mars-tanker': {
      // Long enough to launch in the next Earth–Mars window and arrive.
      const w = windowStatus(day);
      return {
        ...base,
        title: 'Fly a tanker to the Mars plant and unload its propellant',
        payloadId: 'tanker-cargo',
        payout: round5k(550_000 * boost),
        repReward: 10,
        repPenalty: 15,
        deadlineDays: Math.ceil(w.closesDay - day) + 330,
      };
    }
  }
}

/** The board's offers for a 30-day period: deterministic for the period and program state. */
export function generateOffers(period: number, ctx: BoardContext, reputation: number): Contract[] {
  const kinds = contractKindsAvailable(ctx);
  if (!kinds.length) return [];
  const rand = mulberry32(hashString(`board:${period}`));
  const day = period * PERIOD_DAYS;
  const offers: Contract[] = [];
  for (let i = 0; i < OFFERS_PER_BOARD; i++) {
    const kind = kinds[Math.floor(rand() * kinds.length)]!;
    offers.push(makeOffer(kind, rand, `C${period}-${i + 1}`, day, reputation));
  }
  return offers;
}

/** Refreshes the board when a new period starts (or it's empty but contracts are unlocked). */
export function refreshBoard(e: EconomyState, day: number, ctx: BoardContext): EconomyState {
  const period = periodOf(day);
  if (e.board.period === period && (e.board.offers.length || !contractKindsAvailable(ctx).length))
    return e;
  const taken = e.active?.id;
  return {
    ...e,
    board: {
      period,
      offers: generateOffers(period, ctx, e.reputation).filter((o) => o.id !== taken),
    },
  };
}

const clampRep = (r: number) => Math.max(0, Math.min(100, Math.round(r)));

const withOutcome = (e: EconomyState, o: ContractOutcome): EconomyState => ({
  ...e,
  history: [...e.history, o].slice(-MAX_HISTORY),
});

export function acceptContract(
  e: EconomyState,
  id: string,
  day: number,
): { ok: true; economy: EconomyState; contract: ActiveContract } | { ok: false; reason: string } {
  if (e.active)
    return { ok: false, reason: `Finish or cancel "${e.active.title}" first (one at a time).` };
  const offer = e.board.offers.find((o) => o.id === id);
  if (!offer) return { ok: false, reason: 'That offer is no longer on the board.' };
  if (e.reputation < offer.minReputation)
    return {
      ok: false,
      reason: `${offer.client} only works with programs of reputation ${offer.minReputation}+ (yours: ${e.reputation}).`,
    };
  const contract: ActiveContract = {
    ...offer,
    acceptedDay: day,
    deadlineDay: day + offer.deadlineDays,
  };
  return {
    ok: true,
    contract,
    economy: {
      ...e,
      active: contract,
      board: { ...e.board, offers: e.board.offers.filter((o) => o.id !== id) },
    },
  };
}

/** Walks away from the active contract: no payout, half the reputation penalty. */
export function cancelContract(e: EconomyState, day: number): EconomyState {
  const c = e.active;
  if (!c) return e;
  return withOutcome(
    { ...e, active: null, reputation: clampRep(e.reputation - c.repPenalty / 2) },
    { id: c.id, title: c.title, client: c.client, result: 'cancelled', payout: 0, day },
  );
}

/** The contract as the flight sees it (carried in the flight context and its saves). */
export interface FlightContract {
  readonly id: string;
  readonly kind: ContractKind;
  readonly title: string;
  readonly client: string;
  readonly targetAltKm: number | null;
  readonly toleranceKm: number;
  /** Mass released or unloaded (kg). */
  readonly payloadKg: number;
  readonly payout: number;
}

/** What a flight did for the active contract (judged by the flight outcome). */
export interface ContractFlightResult {
  readonly contractId: string;
  readonly met: boolean;
  readonly detail: string;
  /** Mars tanker runs: propellant handed to the plant (kg). */
  readonly deliveredKg?: number;
}

/**
 * Settles the active contract after its flight, on the program day the flight ended. Met in
 * time pays out; late or failed pays nothing and costs reputation.
 */
export function settleContract(
  e: EconomyState,
  result: ContractFlightResult | null,
  day: number,
): { economy: EconomyState; outcome: ContractOutcome | null } {
  const c = e.active;
  if (!c || (result && result.contractId !== c.id)) return { economy: e, outcome: null };
  const met = !!result?.met;
  const late = met && day > c.deadlineDay;
  const resultKind: ContractResult = !met ? 'failed' : late ? 'late' : 'paid';
  const paid = resultKind === 'paid' ? c.payout : 0;
  const outcome: ContractOutcome = {
    id: c.id,
    title: c.title,
    client: c.client,
    result: resultKind,
    payout: paid,
    day,
  };
  return {
    outcome,
    economy: withOutcome(
      {
        ...e,
        active: null,
        treasury: e.treasury + paid,
        reputation: clampRep(e.reputation + (paid ? c.repReward : -c.repPenalty)),
      },
      outcome,
    ),
  };
}

/**
 * Time passes for the program: grants for each new period, an expired contract (deadline gone
 * with no flight) settles as failed, and the board refreshes.
 */
export function advanceEconomy(
  e: EconomyState,
  fromDay: number,
  toDay: number,
  ctx: BoardContext,
): { economy: EconomyState; expired: ContractOutcome | null } {
  let next: EconomyState = { ...e, treasury: e.treasury + grantsBetween(fromDay, toDay) };
  let expired: ContractOutcome | null = null;
  const c = next.active;
  if (c && toDay > c.deadlineDay) {
    expired = {
      id: c.id,
      title: c.title,
      client: c.client,
      result: 'expired',
      payout: 0,
      day: toDay,
    };
    next = withOutcome(
      { ...next, active: null, reputation: clampRep(next.reputation - c.repPenalty) },
      expired,
    );
  }
  return { economy: refreshBoard(next, toDay, ctx), expired };
}

/**
 * Δv to raise a circular parking orbit to a circular orbit at `targetAltKm` (two-burn Hohmann
 * transfer; 0 when the target isn't higher).
 */
export function orbitRaiseDvMS(targetAltKm: number): number {
  const r1 = EARTH_RADIUS_M + PARKING_ORBIT_ALTITUDE_M;
  const r2 = EARTH_RADIUS_M + targetAltKm * 1000;
  if (r2 <= r1) return 0;
  const mu = EARTH_MU_M3S2;
  const a = (r1 + r2) / 2;
  const dv1 = Math.sqrt(mu * (2 / r1 - 1 / a)) - Math.sqrt(mu / r1);
  const dv2 = Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / a));
  return dv1 + dv2;
}
