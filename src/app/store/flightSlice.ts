import { addToPlant, drawFromPlant } from '../../mars/marsRules';
import { CONTRACT_MISSION, settleContract } from '../../economy/contracts';
import { advanceProgram, expiredText } from './economy';
import { MAX_FLIGHT_RECORDS } from '../../persistence/saveGame';
import {
  budgetCredits,
  completeMission,
  economyOf,
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
      const capBefore = budgetCredits(progression);
      const def = findMission(record.missionId);
      const flown = record.result !== 'scrubbed';
      let reward = '';
      // Contract missions pay through their contract, not as story missions.
      if (record.credited && !def?.contract) {
        const r = completeMission(progression, record.missionId);
        if (r.ok && r.firstTime) {
          const rp = researchAvailable(r.progression) - researchAvailable(progression);
          const cr = budgetCredits(r.progression) - budgetCredits(progression);
          reward = ` Reward: +${rp} RP, +${cr.toLocaleString('en-US')} cr.`;
          const unlocked = findMission(record.missionId)?.name;
          if (unlocked) reward += ` "${unlocked}" complete.`;
        }
        if (r.ok) progression = r.progression;
      }
      // Time passes for the whole program: at least a day per flight, or the flight's length.
      const endDay = flown
        ? programDay(progression) + Math.max(1, Math.ceil((record.durationS ?? 0) / 86_400))
        : programDay(progression);
      // The flight's contract is settled on the day it ended.
      let economy = economyOf(progression);
      let contractText = '';
      const active = economy.active;
      if (
        flown &&
        active &&
        (record.contract?.contractId === active.id ||
          record.missionId === CONTRACT_MISSION[active.kind])
      ) {
        const settled = settleContract(economy, record.contract ?? null, endDay);
        economy = settled.economy;
        const o = settled.outcome;
        if (o)
          contractText =
            o.result === 'paid'
              ? ` Contract paid: +${o.payout.toLocaleString('en-US')} cr from ${o.client}.`
              : o.result === 'late'
                ? ` Contract delivered late: ${o.client} pays nothing (reputation down).`
                : ` Contract failed: ${o.client} pays nothing (reputation down).`;
      }
      progression = { ...progression, economy };
      const advanced = advanceProgram(progression, endDay);
      progression = advanced.progression;
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
      // A crewed trip drew propellant from the plant: its stock goes down.
      const trip = m?.returnTrip;
      if (trip && trip.plantDrawKg > 0 && trip.plantDrawDay !== null && progression.marsBase)
        progression = {
          ...progression,
          marsBase: drawFromPlant(
            progression.marsBase,
            trip.plantDrawDay,
            trip.plantDrawKg,
            progression.tech.includes('ice-mining'),
          ),
        };
      // A tanker unloaded into it: the stock goes up.
      const delivered = record.contract?.deliveredKg ?? 0;
      if (delivered > 0 && progression.marsBase)
        progression = {
          ...progression,
          marsBase: addToPlant(
            progression.marsBase,
            m?.landedDay ?? endDay,
            delivered,
            progression.tech.includes('ice-mining'),
          ),
        };
      const bp = s.blueprints.find((b) => b.id === record.designId);
      const fleetOutcome =
        record.result === 'scrubbed'
          ? { fleet: [...s.fleet], text: '' }
          : applyFleetOutcome(s.fleet, record, bp);
      const milestones = awardMilestones(progression, s.blueprints, flights);
      progression = milestones.progression;
      // Money: the flight's cost (priced at commitment) is paid now; first-time mission rewards
      // and milestone credits come in.
      const cost = flown ? (s.mission.commit?.cost ?? 0) : 0;
      const income = Math.max(0, budgetCredits(progression) - capBefore);
      const econ = economyOf(progression);
      progression = {
        ...progression,
        economy: { ...econ, treasury: econ.treasury + income - cost },
      };
      const costText = cost ? ` Flight cost ${cost.toLocaleString('en-US')} cr.` : '';
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
          `${record.missionName}: ${record.summary}${reward}${contractText}${costText}${fleetOutcome.text}${milestones.text}${expiredText(advanced.expired)}`,
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
