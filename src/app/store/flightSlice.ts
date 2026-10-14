import { MAX_FLIGHT_RECORDS } from '../../persistence/saveGame';
import {
  budgetCredits,
  completeMission,
  programDay,
  researchAvailable,
} from '../../progression/research';
import { findMission } from '../../missions/missionCatalog';
import { recordLoss, recordRecovery, type FleetVehicle } from '../../fleet/fleet';
import type { FlightRecord } from '../../launch/flightRecord';
import type { RocketBlueprint } from '../../rocket/model/types';
import { BOOSTER } from '../../recovery/boosterModel';
import { awardMilestones, makeNotice } from './commit';
import type { FlightActions, GetState, SetState } from './types';

let fleetSeq = 0;
const newFleetId = () => `fv-${Date.now().toString(36)}-${(++fleetSeq).toString(36)}`;

/** Applies a flight's recovered and lost hardware to the fleet. Pure apart from new ids. */
export function applyFleetOutcome(
  fleet: readonly FleetVehicle[],
  record: FlightRecord,
  bp: RocketBlueprint | undefined,
): { fleet: FleetVehicle[]; text: string } {
  let next = [...fleet];
  const notes: string[] = [];
  const hw = record.hardware ?? { boosterId: null, shipId: null };
  const r = record.recovery;
  if (r && (r.outcome === 'caught' || r.outcome === 'landed') && bp) {
    const res = recordRecovery(
      next,
      {
        kind: 'booster',
        bp,
        at: record.at,
        grade: r.grade,
        stress: r.heatLoadMJm2 / (BOOSTER.heatLimitJm2 / 1e6),
        reflownId: hw.boosterId,
      },
      newFleetId(),
    );
    next = res.fleet;
    notes.push(`Booster ${res.vehicle.name} recovered${r.grade ? ` (rating ${r.grade})` : ''}.`);
  } else if (hw.boosterId) {
    const lost = next.find((v) => v.id === hw.boosterId);
    next = recordLoss(next, hw.boosterId);
    if (lost) notes.push(`Booster ${lost.name} was lost.`);
  }
  const l = record.landing;
  if (l?.shipRecovered && bp) {
    const res = recordRecovery(
      next,
      {
        kind: 'ship',
        bp,
        at: record.at,
        grade: l.grade ?? null,
        stress: (1 - l.shield) * 0.5 + (1 - l.hull),
        reflownId: hw.shipId,
      },
      newFleetId(),
    );
    next = res.fleet;
    notes.push(`Ship ${res.vehicle.name} recovered.`);
  } else if (hw.shipId && record.result !== 'scrubbed') {
    const lost = next.find((v) => v.id === hw.shipId);
    next = recordLoss(next, hw.shipId);
    if (lost) notes.push(`Ship ${lost.name} was not recovered.`);
  }
  return { fleet: next, text: notes.length ? ` ${notes.join(' ')}` : '' };
}

/** Records launch outcomes, pays mission rewards, updates the fleet and releases the commitment. */
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
      if (record.result !== 'scrubbed') {
        // Time passes for the whole program: at least a day per flight, or the flight's length.
        const days = Math.max(1, Math.ceil((record.durationS ?? 0) / 86_400));
        progression = { ...progression, calendarDay: programDay(progression) + days };
      }
      const m = record.mars;
      if (m?.plantRunning && m.landing && m.landedDay !== null) {
        progression = {
          ...progression,
          marsBase: {
            siteId: m.landing.siteId,
            siteName: m.landing.siteName,
            sinceDay: m.landedDay,
            ice: m.ice ?? 1,
          },
        };
      }
      const bp = s.blueprints.find((b) => b.id === record.designId);
      const fleetOutcome =
        record.result === 'scrubbed'
          ? { fleet: [...s.fleet], text: '' }
          : applyFleetOutcome(s.fleet, record, bp);
      const milestones = awardMilestones(progression, s.blueprints, flights);
      progression = milestones.progression;
      // A flown (or failed) attempt uses up the commitment and the assigned hardware; a scrub
      // keeps both for another try.
      const mission =
        record.result === 'scrubbed'
          ? s.mission
          : { ...s.mission, commit: null, boosterFleetId: null, shipFleetId: null };
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
        fleet: fleetOutcome.fleet,
        notice: makeNotice(
          tone,
          `${record.missionName}: ${record.summary}${reward}${fleetOutcome.text}${milestones.text}`,
        ),
      });
    },
    setRandomFailures: (enabled) => set({ ui: { ...get().ui, randomFailures: enabled } }),
    setPadCamera: (padCamera) => set({ padCamera }),
    setFlightCamera: (flightCamera) => set({ flightCamera }),
    setStationCamera: (stationCamera) => set({ stationCamera }),
    setMoonCamera: (moonCamera) => set({ moonCamera }),
    setMarsCamera: (marsCamera) => set({ marsCamera }),
  };
}
