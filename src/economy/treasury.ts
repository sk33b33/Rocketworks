/*
 * The program treasury: a cash balance. Flights are paid for when they fly (the hardware, tanker
 * flights and refurbishment priced at commitment); first-time mission rewards, milestones and
 * contracts pay into it, and the program office adds a small grant every 30 program days. An empty
 * treasury blocks new commitments but never ends the game. Game values, not real budgets.
 */

/** Balance a new program starts with (cr). */
export const STARTING_TREASURY_CREDITS = 400_000;
/** Program-office grant per period (cr). */
export const GRANT_CREDITS = 15_000;
/** Length of a grant period, and of a contract-board refresh (program days). */
export const PERIOD_DAYS = 30;

/** Grant period a program day falls in. */
export const periodOf = (day: number): number => Math.floor(Math.max(0, day) / PERIOD_DAYS);

/** Grants paid when the calendar moves from `fromDay` to `toDay` (cr; 0 when it doesn't advance). */
export function grantsBetween(fromDay: number, toDay: number): number {
  return Math.max(0, periodOf(toDay) - periodOf(fromDay)) * GRANT_CREDITS;
}

/** Whether the treasury covers a flight costing `costCredits`. */
export function canAfford(treasuryCredits: number, costCredits: number): boolean {
  return costCredits <= treasuryCredits + 1e-6;
}
