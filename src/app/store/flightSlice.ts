import { MAX_FLIGHT_RECORDS } from '../../persistence/saveGame';
import { completeMission, researchAvailable, budgetCredits } from '../../progression/research';
import { findMission } from '../../missions/missionCatalog';
import { makeNotice } from './commit';
import type { FlightActions, GetState, SetState } from './types';

/** Records launch outcomes, pays mission rewards and releases the flown commitment. */
export function createFlightActions(set: SetState, get: GetState): FlightActions {
  return {
    recordFlight: (record) => {
      const s = get();
      if (s.flights.some((f) => f.id === record.id)) return; // idempotent
      const flights = [...s.flights, record].slice(-MAX_FLIGHT_RECORDS);
      let progression = s.progression;
      let reward = '';
      if (record.credited) {
        const r = completeMission(progression, record.missionId);
        if (r.ok && r.firstTime) {
          const rp = researchAvailable(r.progression) - researchAvailable(progression);
          const cr = budgetCredits(r.progression) - budgetCredits(progression);
          reward = ` Reward: +${rp} RP, +${cr.toLocaleString('en-US')} cr budget.`;
          const unlocked = findMission(record.missionId)?.name;
          if (unlocked) reward += ` "${unlocked}" complete.`;
        }
        if (r.ok) progression = r.progression;
      }
      // A flown (or failed) attempt uses up the commitment; a scrub keeps it for another try.
      const mission = record.result === 'scrubbed' ? s.mission : { ...s.mission, commit: null };
      const tone =
        record.result === 'success' || record.result === 'partial'
          ? 'success'
          : record.result === 'scrubbed'
            ? 'info'
            : 'warning';
      set({
        flights,
        progression,
        mission,
        notice: makeNotice(tone, `${record.missionName}: ${record.summary}${reward}`),
      });
    },
    setRandomFailures: (enabled) => set({ ui: { ...get().ui, randomFailures: enabled } }),
    setPadCamera: (padCamera) => set({ padCamera }),
    setFlightCamera: (flightCamera) => set({ flightCamera }),
  };
}
