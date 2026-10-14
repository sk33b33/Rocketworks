import type { AssemblyMode, UiPrefs } from '../../persistence/saveGame';
import type { ProgressionState } from '../../progression/research';
import type { MissionFixAction, MissionTab } from '../../missions/missionReadiness';
import type { MissionSetup } from '../../missions/missionSetup';
import type { FlightRecord } from '../../launch/flightRecord';
import type { FleetVehicle } from '../../fleet/fleet';
import type { RecoveryTarget } from '../../recovery/recoveryPlan';
import type { PadCameraMode } from '../../scenes/launch-pad/launchPadController';
import type { FlightCameraMode } from '../../scenes/flight/flightController';
import type { StationCameraMode } from '../../scenes/station/stationController';
import type { MoonCameraMode } from '../../scenes/moon/moonController';
import type { FixAction } from '../../rocket/readiness/readiness';
import type { HullFinish, RocketBlueprint, SocketRef, VehicleRole } from '../../rocket/model/types';
import type { LocationId } from '../locations';

export type Selection =
  { kind: 'catalog'; partId: string } | { kind: 'instance'; instanceId: string } | null;
export type NoticeTone = 'info' | 'success' | 'warning';
export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly text: string;
  /** Stays until dismissed (used for load-time messages that may appear while the app is busy). */
  readonly sticky?: boolean;
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
export type VehicleTab = 'stats' | 'readiness' | 'program' | 'designs';

export interface History {
  readonly past: readonly RocketBlueprint[];
  readonly future: readonly RocketBlueprint[];
}

export interface GameData {
  currentLocation: LocationId;
  /** All saved designs; the active one is mirrored in `blueprint`. */
  blueprints: readonly RocketBlueprint[];
  activeBlueprintId: string;
  blueprint: RocketBlueprint;
  progression: ProgressionState;
  /** Mission Control plan; survives location changes and reloads. */
  mission: MissionSetup;
  missionTab: MissionTab;
  /** Launch Pad camera mode (not persisted). */
  padCamera: PadCameraMode;
  /** Flight camera mode (not persisted). */
  flightCamera: FlightCameraMode;
  /** Orbital Station camera mode (not persisted). */
  stationCamera: StationCameraMode;
  moonCamera: MoonCameraMode;
  /** Performance readout (session only, not saved). */
  showPerf: boolean;
  /** Flight history (persisted, newest last). */
  flights: readonly FlightRecord[];
  /** Recovered boosters and ships (persisted). */
  fleet: readonly FleetVehicle[];
  history: History;
  selection: Selection;
  notice: Notice | null;
  ui: UiPrefs;
  vehicleTab: VehicleTab;
  cameraRequest: CameraRequest | null;
  saveStatus: SaveStatus;
}

export interface AssemblyActions {
  selectCatalogPart(partId: string): void;
  selectInstance(instanceId: string): void;
  clearSelection(): void;
  attachSelectedTo(ref: SocketRef): boolean;
  attachPartTo(partId: string, ref: SocketRef): boolean;
  fillSelected(): void;
  removeInstance(instanceId: string): void;
  rotateInstance(instanceId: string): void;
  replaceInstance(instanceId: string, partId: string): void;
  runGuideStep(stepId: string): void;
  resetBuild(): void;
  loadReferenceDesign(): void;
  undo(): void;
  redo(): void;
}

export interface LibraryActions {
  switchBlueprint(id: string): void;
  newBlueprint(): void;
  duplicateBlueprint(id: string): void;
  renameBlueprint(id: string, name: string): boolean;
  deleteBlueprint(id: string): void;
  setFinish(finish: HullFinish): void;
  setRole(role: VehicleRole): void;
  certify(override: boolean): void;
}

export interface ProgramActions {
  research(techId: string): void;
}

export interface MissionActions {
  selectMission(missionId: string): void;
  setMissionDesign(designId: string): void;
  setMissionPayload(payloadId: string): void;
  toggleCrew(crewId: string): void;
  waitForWindow(): void;
  commitMission(): void;
  standDown(): void;
  setMissionTab(tab: MissionTab): void;
  setRecovery(target: RecoveryTarget | null): void;
  /** Buys or drops a refuelling option (Moon missions). */
  setRefuel(kind: 'leo' | 'depot', on: boolean): void;
  assignFleet(kind: 'booster' | 'ship', vehicleId: string | null): void;
  refurbishVehicle(id: string): void;
  scrapVehicle(id: string): void;
  runMissionFix(action: MissionFixAction): void;
}

export interface UiActions {
  goTo(target: LocationId): boolean;
  notify(tone: NoticeTone, text: string): void;
  dismissNotice(): void;
  setGuideCollapsed(collapsed: boolean): void;
  setAssemblyMode(mode: AssemblyMode): void;
  setReduceMotion(on: boolean): void;
  setUiScale(scale: number): void;
  setOverviewSeen(seen: boolean): void;
  setShowPerf(on: boolean): void;
  setVehicleTab(tab: VehicleTab): void;
  requestCamera(kind: CameraRequest['kind'], instanceId?: string): void;
  runFixAction(action: FixAction): void;
}

export interface FlightActions {
  /** Called by the launch runtime when an attempt ends (scrub, failure or success). */
  recordFlight(record: FlightRecord): void;
  setRandomFailures(enabled: boolean): void;
  setPadCamera(mode: PadCameraMode): void;
  setFlightCamera(mode: FlightCameraMode): void;
  setStationCamera(mode: StationCameraMode): void;
  setMoonCamera(mode: MoonCameraMode): void;
}

export type GameStore = GameData &
  FlightActions &
  AssemblyActions &
  LibraryActions &
  ProgramActions &
  MissionActions &
  UiActions;
export type SetState = (partial: Partial<GameStore>) => void;
export type GetState = () => GameStore;
