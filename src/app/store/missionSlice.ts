import { findCrew } from '../../missions/crew';
import { findMission, findPayload } from '../../missions/missionCatalog';
import { commitMission } from '../../missions/missionReadiness';
import {
  selectMission,
  setMissionDesign,
  setPayload,
  toggleCrew,
  waitForNextWindow,
  type MissionSetup,
} from '../../missions/missionSetup';
import { generateConditions } from '../../missions/conditions';
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
    commitMission: () => {
      const s = get();
      const bp = s.blueprints.find((b) => b.id === s.mission.designId);
      const report = missionReport(s.mission, s.blueprints, s.progression);
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
        case 'open-tab':
          s.setMissionTab(action.tab);
          break;
      }
    },
  };
}
