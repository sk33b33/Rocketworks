import {
  addNewBlueprint,
  deleteBlueprint,
  duplicateBlueprint,
  renameBlueprint,
  replaceInList,
  setFinish,
  setRole,
} from '../../rocket/library/blueprintLibrary';
import { HULL_FINISHES, VEHICLE_ROLES } from '../../rocket/model/finish';
import type { RocketBlueprint } from '../../rocket/model/types';
import { certify } from '../../rocket/readiness/certification';
import { awardMilestones, commitBlueprint, makeNotice, newBlueprintId, now } from './commit';
import { readinessReport } from './derived';
import type { GetState, LibraryActions, SetState } from './types';

/** Managing the set of saved designs plus design-level settings and certification. */
export function createLibraryActions(set: SetState, get: GetState): LibraryActions {
  const warn = (text: string) => set({ notice: makeNotice('warning', text) });

  /** Replaces the library and activates a design (clears selection and undo history). */
  const activate = (list: readonly RocketBlueprint[], active: RocketBlueprint, message: string) => {
    const { progression, text } = awardMilestones(get().progression, list);
    set({
      blueprints: list,
      activeBlueprintId: active.id,
      blueprint: active,
      progression,
      selection: null,
      history: { past: [], future: [] },
      notice: makeNotice('success', message + text),
    });
    get().requestCamera('reset');
  };

  /** Non-undoable metadata update of the active design. */
  const updateActive = (bp: RocketBlueprint, message: string) => {
    const s = get();
    const blueprints = replaceInList(s.blueprints, bp);
    const { progression, text } = awardMilestones(s.progression, blueprints);
    set({ blueprint: bp, blueprints, progression, notice: makeNotice('success', message + text) });
  };

  return {
    switchBlueprint: (id) => {
      const s = get();
      const target = s.blueprints.find((b) => b.id === id);
      if (!target) return warn('That design no longer exists.');
      if (id === s.activeBlueprintId) return;
      activate(s.blueprints, target, `Opened "${target.name}".`);
    },
    newBlueprint: () => {
      const r = addNewBlueprint(get().blueprints, newBlueprintId(), now());
      if (!r.ok) return warn(r.reason);
      activate(r.list, r.blueprint, `Created "${r.blueprint.name}".`);
    },
    duplicateBlueprint: (id) => {
      const r = duplicateBlueprint(get().blueprints, id, newBlueprintId(), now());
      if (!r.ok) return warn(r.reason);
      activate(r.list, r.blueprint, `Duplicated as "${r.blueprint.name}".`);
    },
    renameBlueprint: (id, name) => {
      const s = get();
      const r = renameBlueprint(s.blueprints, id, name, now());
      if (!r.ok) {
        warn(r.reason);
        return false;
      }
      const blueprints = replaceInList(s.blueprints, r.blueprint);
      set({
        blueprints,
        ...(id === s.activeBlueprintId ? { blueprint: r.blueprint } : {}),
        notice: makeNotice('success', `Renamed to "${r.blueprint.name}".`),
      });
      return true;
    },
    deleteBlueprint: (id) => {
      const s = get();
      const name = s.blueprints.find((b) => b.id === id)?.name ?? 'design';
      const r = deleteBlueprint(s.blueprints, id, s.activeBlueprintId);
      if (!r.ok) return warn(r.reason);
      if (r.activeId === s.activeBlueprintId) {
        set({ blueprints: r.list, notice: makeNotice('success', `Deleted "${name}".`) });
      } else {
        activate(
          r.list,
          r.list.find((b) => b.id === r.activeId)!,
          `Deleted "${name}".`,
        );
      }
    },
    setFinish: (finish) => {
      const bp = setFinish(get().blueprint, finish, now());
      updateActive(
        bp,
        `Hull finish: ${HULL_FINISHES.find((f) => f.id === finish)?.name ?? finish}.`,
      );
    },
    setRole: (role) => {
      const cur = get().blueprint;
      if (cur.role === role) return;
      const label = VEHICLE_ROLES.find((r) => r.id === role)?.name ?? role;
      commitBlueprint(set, get, setRole(cur, role, now()), `Design role set to ${label}.`, {
        budgetCheck: false,
        reportSteps: false,
      });
    },
    certify: (override) => {
      const s = get();
      const report = readinessReport(s.blueprint, s.progression);
      const r = certify(s.blueprint, report, override, now());
      if (!r.ok) return warn(r.reason);
      const msg = r.blueprint.certification?.override
        ? `"${r.blueprint.name}" certified with TUTORIAL OVERRIDE: ${report.criticalCount} critical issue(s) ignored.`
        : `"${r.blueprint.name}" is certified for flight.`;
      updateActive(r.blueprint, msg);
    },
  };
}
