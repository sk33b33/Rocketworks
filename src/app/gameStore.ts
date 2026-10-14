import { create } from 'zustand';
import { DEFAULT_UI, getBrowserStorage, loadGame, writeSave } from '../persistence/saveGame';
import { INITIAL_PROGRESSION } from '../progression/research';
import { createStarterBlueprint } from '../rocket/catalog/blueprints';
import { navigate } from './gameState';
import { DEFAULT_LOCATION } from './locations';
import { createAssemblyActions } from './store/assemblySlice';
import { makeNotice, now } from './store/commit';
import { guideProgress, missionReport, programSummary, readinessReport } from './store/derived';
import { createDefaultSetup } from '../missions/missionSetup';
import { createLibraryActions } from './store/librarySlice';
import { createMissionActions } from './store/missionSlice';
import { createFlightActions } from './store/flightSlice';
import { createProgramActions } from './store/programSlice';
import type { GameData, GameStore, SaveStatus } from './store/types';

export type {
  CameraRequest,
  GameStore,
  Notice,
  NoticeTone,
  SaveStatus,
  Selection,
  VehicleTab,
} from './store/types';

const { storage, persistent } = getBrowserStorage();
const MEMORY_ONLY: SaveStatus = {
  state: 'memory-only',
  message: 'Browser storage is unavailable; progress will not survive a reload.',
};

type LoadedSlice = Pick<
  GameData,
  | 'blueprints'
  | 'activeBlueprintId'
  | 'blueprint'
  | 'progression'
  | 'mission'
  | 'flights'
  | 'fleet'
  | 'ui'
  | 'notice'
  | 'saveStatus'
>;

function initialData(): LoadedSlice {
  const loaded = loadGame(storage);
  if (loaded.status === 'loaded') {
    const { data, warnings } = loaded;
    const active =
      data.blueprints.find((b) => b.id === data.activeBlueprintId) ?? data.blueprints[0]!;
    const problems = warnings.filter((w) => !w.startsWith('Save upgraded'));
    return {
      blueprints: data.blueprints,
      activeBlueprintId: active.id,
      blueprint: active,
      progression: data.progression,
      mission: data.mission ?? createDefaultSetup(active.id),
      flights: data.flights,
      fleet: data.fleet,
      ui: data.ui,
      notice: problems.length
        ? makeNotice(
            'warning',
            `Some saved data was damaged: ${problems.join(' ')} A backup of the original was kept.`,
            true,
          )
        : warnings.length
          ? makeNotice(
              'info',
              'Your save was upgraded to the new format (design library and program progress).',
              true,
            )
          : null,
      saveStatus: persistent ? { state: 'saved', at: data.savedAt } : MEMORY_ONLY,
    };
  }
  const starter = createStarterBlueprint(now());
  return {
    blueprints: [starter],
    activeBlueprintId: starter.id,
    blueprint: starter,
    progression: INITIAL_PROGRESSION,
    mission: createDefaultSetup(starter.id),
    flights: [],
    fleet: [],
    ui: DEFAULT_UI,
    notice:
      loaded.status === 'corrupt' && persistent
        ? makeNotice(
            'warning',
            `Your save could not be loaded (${loaded.reason}) A fresh program was started; the old data is kept as a backup.`,
            true,
          )
        : null,
    saveStatus: persistent ? { state: 'saved', at: now() } : MEMORY_ONLY,
  };
}

let cameraSeq = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  currentLocation: DEFAULT_LOCATION,
  selection: null,
  cameraRequest: null,
  vehicleTab: 'stats',
  missionTab: 'briefing',
  padCamera: 'pad',
  flightCamera: 'chase',
  stationCamera: 'chase',
  history: { past: [], future: [] },
  ...initialData(),

  ...createAssemblyActions(set, get),
  ...createLibraryActions(set, get),
  ...createProgramActions(set, get),
  ...createMissionActions(set, get),
  ...createFlightActions(set, get),

  goTo: (target) => {
    const result = navigate(get().currentLocation, target);
    if (!result.ok) {
      set({ notice: makeNotice('warning', result.reason) });
      return false;
    }
    set({ currentLocation: result.location });
    return true;
  },
  notify: (tone, text) => set({ notice: makeNotice(tone, text) }),
  dismissNotice: () => set({ notice: null }),
  setGuideCollapsed: (guideCollapsed) => set({ ui: { ...get().ui, guideCollapsed } }),
  setAssemblyMode: (assemblyMode) => set({ ui: { ...get().ui, assemblyMode } }),
  setVehicleTab: (vehicleTab) => set({ vehicleTab }),
  requestCamera: (kind, instanceId) =>
    set({ cameraRequest: { seq: ++cameraSeq, kind, ...(instanceId ? { instanceId } : {}) } }),
  runFixAction: (action) => {
    const s = get();
    switch (action.kind) {
      case 'select-part':
        s.selectCatalogPart(action.partId);
        break;
      case 'guide-step':
        s.runGuideStep(action.stepId);
        break;
      case 'select-instance':
        s.selectInstance(action.instanceId);
        s.requestCamera('focus', action.instanceId);
        break;
      case 'set-role':
        s.setRole(action.role);
        break;
      case 'open-program':
        s.setVehicleTab('program');
        break;
    }
  },
}));

// Autosave whenever persisted data changes.
useGameStore.subscribe((s, prev) => {
  if (
    s.blueprints === prev.blueprints &&
    s.activeBlueprintId === prev.activeBlueprintId &&
    s.progression === prev.progression &&
    s.mission === prev.mission &&
    s.flights === prev.flights &&
    s.fleet === prev.fleet &&
    s.ui === prev.ui
  )
    return;
  if (!persistent) return;
  const at = now();
  const result = writeSave(storage, {
    savedAt: at,
    activeBlueprintId: s.activeBlueprintId,
    blueprints: s.blueprints,
    progression: s.progression,
    mission: s.mission,
    flights: s.flights,
    fleet: s.fleet,
    ui: s.ui,
  });
  useGameStore.setState({
    saveStatus: result.ok
      ? { state: 'saved', at }
      : { state: 'error', message: `Autosave failed: ${result.reason}` },
  });
});

// ---- Selectors (memoized, stable references) ----
export const selectGuide = (s: Pick<GameStore, 'blueprint'>) => guideProgress(s.blueprint);
export const selectProgram = (s: Pick<GameStore, 'progression'>) => programSummary(s.progression);
export const selectReadiness = (s: Pick<GameStore, 'blueprint' | 'progression'>) =>
  readinessReport(s.blueprint, s.progression);
export const selectMissionReport = (
  s: Pick<GameStore, 'mission' | 'blueprints' | 'progression' | 'fleet'>,
) => missionReport(s.mission, s.blueprints, s.progression, s.fleet);
