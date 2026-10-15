import {
  advanceEconomy,
  refreshBoard,
  type BoardContext,
  type ContractOutcome,
  type EconomyState,
} from '../../economy/contracts';
import { economyOf, programDay, type ProgressionState } from '../../progression/research';

/*
 * Store-side glue for the economy: what the contract board depends on, and moving the program
 * calendar (grants, expired contracts, a fresh board) in one place.
 */

export function boardContext(p: ProgressionState): BoardContext {
  return { completedMissionIds: p.completedMissions, hasMarsBase: !!p.marsBase };
}

/** Moves the program calendar to `toDay`: grants, contract expiry and the board. */
export function advanceProgram(
  p: ProgressionState,
  toDay: number,
): { progression: ProgressionState; expired: ContractOutcome | null } {
  const from = programDay(p);
  const r = advanceEconomy(economyOf(p), from, Math.max(from, toDay), boardContext(p));
  return {
    progression: { ...p, calendarDay: Math.max(from, toDay), economy: r.economy },
    expired: r.expired,
  };
}

let boardCache: { p: ProgressionState; v: EconomyState } | null = null;
/** The economy with today's board (memoized; the stored board catches up on the next change). */
export function currentEconomy(p: ProgressionState): EconomyState {
  if (boardCache?.p !== p)
    boardCache = { p, v: refreshBoard(economyOf(p), programDay(p), boardContext(p)) };
  return boardCache.v;
}

export function expiredText(o: ContractOutcome | null): string {
  return o ? ` Contract "${o.title}" expired: the deadline passed (reputation down).` : '';
}
