import { programDay } from '../../progression/research';
import { findCrew } from '../../missions/crew';
import { findMission, findPayload } from '../../missions/missionCatalog';
import { commitMission } from '../../missions/missionReadiness';
import {
  assignFleet,
  selectMission,
  setRecovery,
  setRefuel,
  setMissionDesign,
  setPayload,
  setupForContract,
  toggleCrew,
  waitForNextWindow,
  type MissionSetup,
} from '../../missions/missionSetup';
import { acceptContract, cancelContract } from '../../economy/contracts';
import { advanceProgram, currentEconomy, expiredText } from './economy';
import { generateConditions } from '../../missions/conditions';
import { RECOVERY_LABELS } from '../../recovery/recoveryPlan';
import { refurbish, scrap } from '../../fleet/fleet';
import { makeNotice, now } from './commit';
import { missionReport } from './derived';
import type { GetState, MissionActions, SetState } from './types';

const CONDITION_TEXT = { green: 'GO', amber: 'marginal', red: 'NO-GO' } as const;

/** Mission Control planning: mission choice, manifest, launch window and commitment. */
export function createMissionActions(set: SetState, get: GetState): MissionActions {
  const warn = (text: string) => set({ notice: makeNotice('warning', text) });
  const update = (mission: MissionSetup, message: string) =>
    set({ mission, notice: makeNotice('success', message) });

  return {
    selectMission: (missionId) => {
      const s = get();
      const r = selectMission(s.mission, missionId, s.progression.completedMissions);
      if (!r.ok) return warn(r.reason);
      if (r.setup !== s.mission)
        update(r.setup, `Mission selected: ${findMission(missionId)?.name}.`);
    },
    setMissionDesign: (designId) => {
      const s = get();
      const bp = s.blueprints.find((b) => b.id === designId);
      if (!bp) return warn('That design no longer exists.');
      update(setMissionDesign(s.mission, designId), `Vehicle assigned: "${bp.name}".`);
    },
    setMissionPayload: (payloadId) => {
      const r = setPayload(get().mission, payloadId);
      if (!r.ok) return warn(r.reason);
      update(r.setup, `Payload: ${findPayload(payloadId)?.name}.`);
    },
    toggleCrew: (crewId) => {
      const before = get().mission;
      const r = toggleCrew(before, crewId);
      if (!r.ok) return warn(r.reason);
      const name = findCrew(crewId)?.name ?? crewId;
      update(r.setup, r.setup.crewIds.includes(crewId) ? `${name} assigned.` : `${name} removed.`);
    },
    waitForWindow: () => {
      const next = waitForNextWindow(get().mission);
      const c = generateConditions(next.conditionsSeed);
      update(
        next,
        `Stood down for the next window (T-${c.windowOpensInHours} h). Weather: ${CONDITION_TEXT[c.overall]}.`,
      );
    },
    waitForMarsWindow: (toDay) => {
      const s = get();
      const day = programDay(s.progression);
      if (toDay <= day) return;
      const r = advanceProgram(s.progression, toDay);
      set({
        progression: r.progression,
        mission: { ...s.mission, commit: null },
        notice: makeNotice(
          r.expired ? 'warning' : 'success',
          `Waited ${toDay - day} days: the Mars launch window is open (day ${toDay}).${expiredText(r.expired)}`,
        ),
      });
    },
    acceptContract: (id) => {
      const s = get();
      const day = programDay(s.progression);
      const r = acceptContract(currentEconomy(s.progression), id, day);
      if (!r.ok) return warn(r.reason);
      set({
        progression: { ...s.progression, economy: r.economy },
        mission: setupForContract(s.mission, r.contract),
        missionTab: 'manifest',
        notice: makeNotice(
          'success',
          `Contract accepted: ${r.contract.title} for ${r.contract.client}, due by day ${r.contract.deadlineDay}. Plan the flight in the Manifest.`,
        ),
      });
    },
    cancelContract: () => {
      const s = get();
      const e = currentEconomy(s.progression);
      if (!e.active) return;
      const title = e.active.title;
      const flying = findMission(s.mission.missionId)?.contract === e.active.kind;
      const back = flying
        ? selectMission(s.mission, 'test-flight', s.progression.completedMissions)
        : null;
      set({
        progression: {
          ...s.progression,
          economy: cancelContract(e, programDay(s.progression)),
        },
        ...(back?.ok ? { mission: back.setup } : {}),
        notice: makeNotice('warning', `Contract cancelled: ${title}. Reputation down.`),
      });
    },
    commitMission: () => {
      const s = get();
      const bp = s.blueprints.find((b) => b.id === s.mission.designId);
      const report = missionReport(s.mission, s.blueprints, s.progression, s.fleet);
      const r = commitMission(s.mission, bp, report, now());
      if (!r.ok) return warn(r.reason);
      set({
        mission: r.setup,
        notice: makeNotice(
          'success',
          `GO for rollout: "${report.mission.name}" is committed with "${bp?.name}". Head to the Launch Pad.`,
        ),
      });
    },
    standDown: () => {
      const s = get();
      if (!s.mission.commit) return;
      update({ ...s.mission, commit: null }, 'Mission stood down; back to planning.');
    },
    setRefuel: (kind, on) => {
      update(
        setRefuel(get().mission, kind, on),
        `${kind === 'leo' ? 'Orbital refuelling' : 'Lunar depot top-up'} ${on ? 'added' : 'removed'}.`,
      );
    },
    setRecovery: (target) => {
      update(
        setRecovery(get().mission, target),
        target ? `Booster recovery: ${RECOVERY_LABELS[target]}.` : 'Booster recovery: automatic.',
      );
    },
    assignFleet: (kind, vehicleId) => {
      const s = get();
      const v = vehicleId ? s.fleet.find((f) => f.id === vehicleId) : null;
      if (vehicleId && !v) return warn('That vehicle is no longer in the fleet.');
      update(
        assignFleet(s.mission, kind, vehicleId),
        v ? `${v.name} assigned to fly again.` : `New-build ${kind} selected.`,
      );
    },
    refurbishVehicle: (id) => {
      const s = get();
      const v = s.fleet.find((f) => f.id === id);
      if (!v) return warn('That vehicle is no longer in the fleet.');
      const used = s.mission.boosterFleetId === id || s.mission.shipFleetId === id;
      set({
        fleet: refurbish(s.fleet, id),
        ...(used ? { mission: { ...s.mission, commit: null } } : {}),
        notice: makeNotice(
          'success',
          `${v.name} refurbished: wear reset. Its next flight carries a refurbishment charge.`,
        ),
      });
    },
    scrapVehicle: (id) => {
      const s = get();
      const v = s.fleet.find((f) => f.id === id);
      if (!v) return;
      const mission = {
        ...s.mission,
        boosterFleetId: s.mission.boosterFleetId === id ? null : s.mission.boosterFleetId,
        shipFleetId: s.mission.shipFleetId === id ? null : s.mission.shipFleetId,
      };
      set({
        fleet: scrap(s.fleet, id),
        mission,
        notice: makeNotice('info', `${v.name} scrapped.`),
      });
    },
    setMissionTab: (missionTab) => set({ missionTab }),
    runMissionFix: (action) => {
      const s = get();
      switch (action.kind) {
        case 'go-factory':
          if (s.goTo('factory')) s.setVehicleTab(action.tab);
          break;
        case 'wait-window':
          s.waitForWindow();
          break;
        case 'wait-mars-window':
          s.waitForMarsWindow(action.toDay);
          break;
        case 'open-tab':
          s.setMissionTab(action.tab);
          break;
      }
    },
  };
}
