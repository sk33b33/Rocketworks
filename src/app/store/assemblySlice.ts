import { describeSocket, findInstance } from '../../rocket/assembly/compatibility';
import {
  attachPart,
  fillCompatible,
  removePart,
  replacePart,
  rotatePart,
} from '../../rocket/assembly/operations';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../../rocket/catalog/blueprints';
import { findPart, getPart } from '../../rocket/catalog/parts';
import { replaceInList } from '../../rocket/library/blueprintLibrary';
import type { RocketBlueprint } from '../../rocket/model/types';
import { autoCompleteStep, STARTER_GUIDE } from '../../rocket/tutorial/starterGuide';
import { commitBlueprint, makeNotice, now, validSelection } from './commit';
import { programSummary } from './derived';
import type { AssemblyActions, GetState, SetState } from './types';

/** Selection, part placement/editing, guided steps and undo/redo for the active design. */
export function createAssemblyActions(set: SetState, get: GetState): AssemblyActions {
  const warn = (text: string) => set({ notice: makeNotice('warning', text) });
  const unlocked = () => programSummary(get().progression).unlockedPartIds;

  /** Starter/reference resets keep the design's identity, name, finish and role. */
  const keepIdentity = (fresh: RocketBlueprint): RocketBlueprint => {
    const cur = get().blueprint;
    return {
      ...fresh,
      id: cur.id,
      name: cur.name,
      createdAt: cur.createdAt,
      finish: cur.finish,
      role: cur.role,
      revision: cur.revision + 1,
    };
  };

  const attach = (partId: string, ref: Parameters<AssemblyActions['attachPartTo']>[1]) => {
    const { blueprint } = get();
    const result = attachPart(blueprint, partId, ref, now(), unlocked());
    if (!result.ok) {
      warn(result.reason);
      return false;
    }
    return commitBlueprint(
      set,
      get,
      result.blueprint,
      `Attached ${getPart(partId).name} to ${describeSocket(blueprint, ref)}.`,
    );
  };

  return {
    selectCatalogPart: (partId) => {
      if (findPart(partId)) set({ selection: { kind: 'catalog', partId } });
    },
    selectInstance: (instanceId) => {
      if (findInstance(get().blueprint, instanceId))
        set({ selection: { kind: 'instance', instanceId } });
    },
    clearSelection: () => set({ selection: null }),

    attachSelectedTo: (ref) => {
      const { selection } = get();
      if (selection?.kind !== 'catalog') {
        warn('Select a part from the catalog first, then click a highlighted attachment point.');
        return false;
      }
      return attach(selection.partId, ref);
    },
    attachPartTo: attach,
    fillSelected: () => {
      const { selection, blueprint } = get();
      if (selection?.kind !== 'catalog') return;
      const result = fillCompatible(blueprint, selection.partId, now(), unlocked());
      if (!result.ok) return warn(result.reason);
      commitBlueprint(
        set,
        get,
        result.blueprint,
        `Attached ${result.attachedCount} × ${getPart(selection.partId).name}.`,
      );
    },
    removeInstance: (instanceId) => {
      const { blueprint } = get();
      const inst = findInstance(blueprint, instanceId);
      const result = removePart(blueprint, instanceId, now());
      if (!result.ok || !inst) return warn(result.ok ? 'Part not found.' : result.reason);
      const extra =
        result.removedCount > 1 ? ` and ${result.removedCount - 1} attached part(s)` : '';
      commitBlueprint(
        set,
        get,
        result.blueprint,
        `Removed ${getPart(inst.partId).name}${extra}. Undo with Ctrl+Z.`,
      );
    },
    rotateInstance: (instanceId) => {
      const result = rotatePart(get().blueprint, instanceId, now());
      if (!result.ok) return warn(result.reason);
      commitBlueprint(set, get, result.blueprint, `Rotated to ${result.rotationDeg}°.`);
    },
    replaceInstance: (instanceId, partId) => {
      const { blueprint } = get();
      const old = findInstance(blueprint, instanceId);
      const result = replacePart(blueprint, instanceId, partId, now(), unlocked());
      if (!result.ok || !old) return warn(result.ok ? 'Part not found.' : result.reason);
      const dropped = result.droppedCount
        ? ` ${result.droppedCount} part(s) that no longer fit were removed.`
        : '';
      commitBlueprint(
        set,
        get,
        result.blueprint,
        `Replaced ${getPart(old.partId).name} with ${getPart(partId).name}.${dropped}`,
      );
    },
    runGuideStep: (stepId) => {
      const step = STARTER_GUIDE.find((s) => s.id === stepId);
      if (!step) return;
      const result = autoCompleteStep(get().blueprint, step, now());
      if (!result.ok) return warn(result.reason);
      commitBlueprint(
        set,
        get,
        result.blueprint,
        `Assembly crew completed "${step.title}" (${result.attached} part(s)).`,
      );
    },
    resetBuild: () => {
      if (
        commitBlueprint(
          set,
          get,
          keepIdentity(createStarterBlueprint(now())),
          'Design reset to the starter configuration.',
          { reportSteps: false, extra: { selection: null } },
        )
      )
        get().requestCamera('reset');
    },
    loadReferenceDesign: () => {
      if (
        commitBlueprint(
          set,
          get,
          keepIdentity(createCompleteStarterDesign(now())),
          'Loaded the complete reference design.',
          { reportSteps: false, extra: { selection: null } },
        )
      )
        get().requestCamera('reset');
    },

    undo: () => {
      const s = get();
      const previous = s.history.past[s.history.past.length - 1];
      if (!previous) return warn('Nothing to undo.');
      set({
        blueprint: previous,
        blueprints: replaceInList(s.blueprints, previous),
        history: { past: s.history.past.slice(0, -1), future: [s.blueprint, ...s.history.future] },
        selection: validSelection(s.selection, previous),
        notice: makeNotice('info', 'Undid the last change.'),
      });
    },
    redo: () => {
      const s = get();
      const next = s.history.future[0];
      if (!next) return warn('Nothing to redo.');
      set({
        blueprint: next,
        blueprints: replaceInList(s.blueprints, next),
        history: { past: [...s.history.past, s.blueprint], future: s.history.future.slice(1) },
        selection: validSelection(s.selection, next),
        notice: makeNotice('info', 'Redid the change.'),
      });
    },
  };
}
