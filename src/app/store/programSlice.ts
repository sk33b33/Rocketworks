import { findTech, purchaseTech } from '../../progression/research';
import { makeNotice } from './commit';
import type { GetState, ProgramActions, SetState } from './types';

export function createProgramActions(set: SetState, get: GetState): ProgramActions {
  return {
    research: (techId) => {
      const r = purchaseTech(get().progression, techId);
      if (!r.ok) return set({ notice: makeNotice('warning', r.reason) });
      set({
        progression: r.progression,
        notice: makeNotice('success', `Research complete: ${findTech(techId)?.name ?? techId}.`),
      });
    },
  };
}
