import { create } from 'zustand';
import { getBrowserStorage, loadGame, writeSave } from '../persistence/saveGame';
import { describeSocket, findInstance } from '../rocket/assembly/compatibility';
import {
  attachPart,
  fillCompatible,
  removePart,
  replacePart,
  rotatePart,
} from '../rocket/assembly/operations';
import { createCompleteStarterDesign, createStarterBlueprint } from '../rocket/catalog/blueprints';
import { findPart, getPart } from '../rocket/catalog/parts';
import type { RocketBlueprint, SocketRef } from '../rocket/model/types';
import { autoCompleteStep, evaluateGuide, STARTER_GUIDE } from '../rocket/tutorial/starterGuide';
import { navigate } from './gameState';
import { DEFAULT_LOCATION, type LocationId } from './locations';

export type Selection =
  { kind: 'catalog'; partId: string } | { kind: 'instance'; instanceId: string } | null;
export type NoticeTone = 'info' | 'success' | 'warning';
export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly text: string;
}
export interface CameraRequest {
  readonly seq: number;
  readonly kind: 'reset' | 'focus';
  readonly instanceId?: string;
}
export interface SaveStatus {
  readonly state: 'saved' | 'error' | 'memory-only';
  readonly at?: string;
  readonly message?: string;
}

export interface GameStore {
  currentLocation: LocationId;
  blueprint: RocketBlueprint;
  selection: Selection;
  notice: Notice | null;
  guideCollapsed: boolean;
  cameraRequest: CameraRequest | null;
  saveStatus: SaveStatus;

  goTo(target: LocationId): boolean;
  notify(tone: NoticeTone, text: string): void;
  dismissNotice(): void;
  selectCatalogPart(partId: string): void;
  selectInstance(instanceId: string): void;
  clearSelection(): void;
  attachSelectedTo(ref: SocketRef): boolean;
  fillSelected(): void;
  removeInstance(instanceId: string): void;
  rotateInstance(instanceId: string): void;
  replaceInstance(instanceId: string, partId: string): void;
  runGuideStep(stepId: string): void;
  resetBuild(): void;
  loadReferenceDesign(): void;
  setGuideCollapsed(collapsed: boolean): void;
  requestCamera(kind: CameraRequest['kind'], instanceId?: string): void;
}

const now = () => new Date().toISOString();
const { storage, persistent } = getBrowserStorage();

function initialState(): Pick<GameStore, 'blueprint' | 'guideCollapsed' | 'notice' | 'saveStatus'> {
  const loaded = loadGame(storage);
  const memoryOnly: SaveStatus = {
    state: 'memory-only',
    message: 'Browser storage is unavailable; progress will not survive a reload.',
  };
  if (loaded.status === 'loaded') {
    return {
      blueprint: loaded.data.blueprint,
      guideCollapsed: loaded.data.guideCollapsed,
      notice: null,
      saveStatus: persistent ? { state: 'saved', at: loaded.data.savedAt } : memoryOnly,
    };
  }
  return {
    blueprint: createStarterBlueprint(now()),
    guideCollapsed: false,
    notice:
      loaded.status === 'corrupt' && persistent
        ? {
            id: 1,
            tone: 'warning',
            text: `Your saved build could not be loaded (${loaded.reason}) A fresh starter build was created; the old data is kept as a backup.`,
          }
        : null,
    saveStatus: persistent ? { state: 'saved', at: now() } : memoryOnly,
  };
}

let noticeSeq = 1;
let cameraSeq = 0;

/** Message listing guide steps that the change just completed. */
function stepCompletionSuffix(before: RocketBlueprint, after: RocketBlueprint): string {
  const done = STARTER_GUIDE.filter((s) => !s.isDone(before) && s.isDone(after));
  return done.length ? ` ✓ Step complete: ${done.map((s) => s.title).join('; ')}.` : '';
}

export const useGameStore = create<GameStore>((set, get) => {
  /** Applies a new blueprint plus a confirmation notice. */
  const commit = (
    blueprint: RocketBlueprint,
    message: string,
    extra: Partial<GameStore> = {},
    reportSteps = true,
  ) => {
    const suffix = reportSteps ? stepCompletionSuffix(get().blueprint, blueprint) : '';
    set({
      blueprint,
      notice: { id: ++noticeSeq, tone: 'success', text: message + suffix },
      ...extra,
    });
  };
  const warn = (text: string) => set({ notice: { id: ++noticeSeq, tone: 'warning', text } });

  return {
    currentLocation: DEFAULT_LOCATION,
    selection: null,
    cameraRequest: null,
    ...initialState(),

    goTo: (target) => {
      const result = navigate(get().currentLocation, target);
      if (!result.ok) {
        warn(result.reason);
        return false;
      }
      set({ currentLocation: result.location });
      return true;
    },
    notify: (tone, text) => set({ notice: { id: ++noticeSeq, tone, text } }),
    dismissNotice: () => set({ notice: null }),

    selectCatalogPart: (partId) => {
      if (!findPart(partId)) return;
      set({ selection: { kind: 'catalog', partId } });
    },
    selectInstance: (instanceId) => {
      if (findInstance(get().blueprint, instanceId))
        set({ selection: { kind: 'instance', instanceId } });
    },
    clearSelection: () => set({ selection: null }),

    attachSelectedTo: (ref) => {
      const { selection, blueprint } = get();
      if (selection?.kind !== 'catalog') {
        warn('Select a part from the catalog first, then click a highlighted attachment point.');
        return false;
      }
      const result = attachPart(blueprint, selection.partId, ref, now());
      if (!result.ok) {
        warn(result.reason);
        return false;
      }
      commit(
        result.blueprint,
        `Attached ${getPart(selection.partId).name} to ${describeSocket(blueprint, ref)}.`,
      );
      return true;
    },
    fillSelected: () => {
      const { selection, blueprint } = get();
      if (selection?.kind !== 'catalog') return;
      const result = fillCompatible(blueprint, selection.partId, now());
      if (!result.ok) return warn(result.reason);
      commit(
        result.blueprint,
        `Attached ${result.attachedCount} × ${getPart(selection.partId).name}.`,
      );
    },
    removeInstance: (instanceId) => {
      const { blueprint, selection } = get();
      const inst = findInstance(blueprint, instanceId);
      const result = removePart(blueprint, instanceId, now());
      if (!result.ok || !inst) return warn(result.ok ? 'Part not found.' : result.reason);
      const name = getPart(inst.partId).name;
      const extra =
        result.removedCount > 1 ? ` and ${result.removedCount - 1} attached part(s)` : '';
      const keepSelection =
        selection?.kind === 'instance' &&
        selection.instanceId !== instanceId &&
        findInstance(result.blueprint, selection.instanceId);
      commit(result.blueprint, `Removed ${name}${extra}.`, {
        selection: keepSelection ? selection : null,
      });
    },
    rotateInstance: (instanceId) => {
      const result = rotatePart(get().blueprint, instanceId, now());
      if (!result.ok) return warn(result.reason);
      commit(result.blueprint, `Rotated to ${result.rotationDeg}°.`);
    },
    replaceInstance: (instanceId, partId) => {
      const { blueprint } = get();
      const old = findInstance(blueprint, instanceId);
      const result = replacePart(blueprint, instanceId, partId, now());
      if (!result.ok || !old) return warn(result.ok ? 'Part not found.' : result.reason);
      const dropped = result.droppedCount
        ? ` ${result.droppedCount} part(s) that no longer fit were removed.`
        : '';
      commit(
        result.blueprint,
        `Replaced ${getPart(old.partId).name} with ${getPart(partId).name}.${dropped}`,
      );
    },
    runGuideStep: (stepId) => {
      const step = STARTER_GUIDE.find((s) => s.id === stepId);
      if (!step) return;
      const result = autoCompleteStep(get().blueprint, step, now());
      if (!result.ok) return warn(result.reason);
      commit(
        result.blueprint,
        `Assembly crew completed "${step.title}" (${result.attached} part(s)).`,
      );
    },
    resetBuild: () => {
      set({ selection: null });
      commit(createStarterBlueprint(now()), 'Build reset to the starter configuration.', {}, false);
      get().requestCamera('reset');
    },
    loadReferenceDesign: () => {
      set({ selection: null });
      commit(
        createCompleteStarterDesign(now()),
        'Loaded the complete reference design.',
        {},
        false,
      );
      get().requestCamera('reset');
    },
    setGuideCollapsed: (guideCollapsed) => set({ guideCollapsed }),
    requestCamera: (kind, instanceId) =>
      set({ cameraRequest: { seq: ++cameraSeq, kind, ...(instanceId ? { instanceId } : {}) } }),
  };
});

// Autosave whenever the blueprint or guide preference changes.
useGameStore.subscribe((state, prev) => {
  if (state.blueprint === prev.blueprint && state.guideCollapsed === prev.guideCollapsed) return;
  if (!persistent) return;
  const at = now();
  const result = writeSave(storage, state.blueprint, state.guideCollapsed, at);
  useGameStore.setState({
    saveStatus: result.ok
      ? { state: 'saved', at }
      : { state: 'error', message: `Autosave failed: ${result.reason}` },
  });
});

/** Derived guide progress; memoized per blueprint object. */
let guideCache: { bp: RocketBlueprint; progress: ReturnType<typeof evaluateGuide> } | null = null;
export function selectGuide(state: Pick<GameStore, 'blueprint'>) {
  if (guideCache?.bp !== state.blueprint)
    guideCache = { bp: state.blueprint, progress: evaluateGuide(state.blueprint) };
  return guideCache.progress;
}
