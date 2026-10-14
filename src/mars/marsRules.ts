import type { MarsSite } from './marsSites';

/*
 * Mars mission rules shared by Mission Control and the flight: the Δv legs, surface tasks and the
 * propellant plant. Game values chosen for progression, not mission design.
 */

/** Allowance for course corrections and the approach correction (m/s). */
export const MARS_CORRECTION_RESERVE_MS = 150;
/** Entry is aerodynamic; the landing burn needs up to this from the thin air at high sites. */
export const MARS_LANDING_DV_MS = 1_900;
/** Propellant plant output at a site with plenty of ice (kg per day). */
export const PLANT_BASE_KG_PER_DAY = 1_200;
/** What the plant can store before the next ship comes for it (kg). */
export const PLANT_CAPACITY_KG = 1_200_000;
/** Mass of the propellant plant cargo (it rides in the ship as payload). */
export const PLANT_CARGO_KG = 40_000;

export interface MarsLegCheck {
  readonly id: 'transfer' | 'landing';
  readonly label: string;
  readonly requiredDvMS: number;
  /** Δv the ship has for this leg (m/s). */
  readonly availableMS: number;
  readonly ok: boolean;
}

/**
 * Δv legs of a Mars cargo landing: the injection (plus corrections) from the refuelled parking
 * orbit, then entry and the landing burn on what's left.
 * @param tmiDvMS injection burn for a departure today (null outside the window)
 * @param fullShipDvMS ship Δv with full tanks and the payload
 * @param inOrbitDvMS ship Δv left on reaching orbit
 */
export function checkMarsLegs(
  tmiDvMS: number | null,
  refuelLeo: boolean,
  fullShipDvMS: number,
  inOrbitDvMS: number,
): MarsLegCheck[] {
  const first = refuelLeo ? fullShipDvMS : inOrbitDvMS;
  const transferNeed = (tmiDvMS ?? Infinity) + MARS_CORRECTION_RESERVE_MS;
  const left = Math.max(0, first - (Number.isFinite(transferNeed) ? transferNeed : first));
  return [
    {
      id: 'transfer',
      label: 'Trans-Mars injection and course corrections',
      requiredDvMS: transferNeed,
      availableMS: first,
      ok: first >= transferNeed,
    },
    {
      id: 'landing',
      label: 'Entry and landing burn',
      requiredDvMS: MARS_LANDING_DV_MS,
      availableMS: left,
      ok: left >= MARS_LANDING_DV_MS,
    },
  ];
}

// ---- the propellant plant ----

/** A propellant plant left on Mars by a cargo landing (kept in the program's progression). */
export interface MarsBase {
  readonly siteId: string;
  readonly siteName: string;
  /** Program day production started. */
  readonly sinceDay: number;
  /** 0..1 ice factor of the site. */
  readonly ice: number;
}

/** Plant output (kg per day) for a site's ice; better drills (research) make 50% more. */
export function plantRateKgPerDay(ice: number, boosted = false): number {
  return Math.round(PLANT_BASE_KG_PER_DAY * (0.3 + 0.7 * ice) * (boosted ? 1.5 : 1));
}

/** Propellant the plant has made by a program day (kg, capped by its storage). */
export function plantStockKg(base: MarsBase, day: number, boosted = false): number {
  const days = Math.max(0, day - base.sinceDay);
  return Math.min(PLANT_CAPACITY_KG, Math.round(days * plantRateKgPerDay(base.ice, boosted)));
}

// ---- surface tasks ----

export interface MarsTask {
  readonly id: string;
  readonly label: string;
  readonly durationS: number;
  /** Starts when this task is finished (or right away). */
  readonly after?: string;
}

const HOUR = 3_600;
const DAY = 86_400;

export function marsSurfaceTasks(site: MarsSite, plant: boolean): MarsTask[] {
  const tasks: MarsTask[] = [
    { id: 'safing', label: 'Post-landing checks and safing', durationS: 2 * HOUR },
    {
      id: 'survey',
      label: `Survey ${site.name} with the ship's cameras`,
      durationS: 12 * HOUR,
      after: 'safing',
    },
    {
      id: 'unload',
      label: plant ? 'Lower the propellant plant to the ground' : 'Unload the cargo',
      durationS: DAY,
      after: 'safing',
    },
  ];
  if (plant)
    tasks.push(
      {
        id: 'deploy',
        label: 'Deploy solar arrays and the ice drill',
        durationS: 1.5 * DAY,
        after: 'unload',
      },
      {
        id: 'first-run',
        label: 'First propellant production run',
        durationS: 3 * DAY,
        after: 'deploy',
      },
    );
  return tasks;
}

/** 0..1 progress of each task after `elapsedS` on the surface (dependencies run in order). */
export function marsSurfaceProgress(tasks: readonly MarsTask[], elapsedS: number): number[] {
  const end = new Map<string, number>();
  const startOf = (t: MarsTask): number => (t.after ? (end.get(t.after) ?? 0) : 0);
  for (const t of tasks) end.set(t.id, startOf(t) + t.durationS);
  return tasks.map((t) => Math.max(0, Math.min(1, (elapsedS - startOf(t)) / t.durationS)));
}

/** Total surface time until every task is done (s). */
export function marsSurfaceDurationS(tasks: readonly MarsTask[]): number {
  const end = new Map<string, number>();
  let max = 0;
  for (const t of tasks) {
    const e = (t.after ? (end.get(t.after) ?? 0) : 0) + t.durationS;
    end.set(t.id, e);
    max = Math.max(max, e);
  }
  return max;
}
