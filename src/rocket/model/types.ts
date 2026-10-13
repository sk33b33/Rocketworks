/**
 * Rocket domain model. Pure data: no Three.js, React or DOM imports.
 * Units are SI (kg, N, m) unless a name says otherwise. Values are game-tuned approximations.
 */

export type Vec3 = readonly [number, number, number];

/** What kind of connector a socket provides; a part plugs into exactly one socket type. */
export type SocketType =
  | 'root'
  | 'booster-stack'
  | 'interstage'
  | 'ship-base'
  | 'ship-stack'
  | 'engine'
  | 'grid-fin'
  | 'flap-forward'
  | 'flap-aft'
  | 'leg'
  | 'heat-shield'
  | 'detail'
  | 'docking';

export type PartCategory =
  | 'structure'
  | 'tank'
  | 'crew'
  | 'propulsion'
  | 'control'
  | 'landing'
  | 'thermal'
  | 'docking'
  | 'detail';

export type VehicleStage = 'booster' | 'ship';

export type PartTag = 'crew' | 'payload' | 'docking' | 'landing' | 'reentry' | 'vacuum' | 'rcs';

/** Size hint for parts that wrap their parent's surface (e.g. heat-shield tiles). */
export interface SocketSpan {
  readonly heightM: number;
  readonly profile: 'cylinder' | 'ogive';
}

/**
 * A socket's transform is relative to its part's origin. The attached child's local +Y follows
 * the socket's +Y; for radial sockets the child's local +X points away from the hull.
 */
export interface SocketDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: SocketType;
  readonly position: Vec3;
  /** Euler XYZ, radians. */
  readonly rotation: Vec3;
  readonly span?: SocketSpan;
}

export type UnlockStatus =
  { readonly unlocked: true } | { readonly unlocked: false; readonly reason: string };

export interface PartDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: PartCategory;
  /** Stack sections declare their stage; attached parts inherit it. */
  readonly stage?: VehicleStage;
  readonly dryMassKg: number;
  readonly costCredits: number;
  readonly propellantCapacityKg?: number;
  /** Sea-level thrust, game-tuned. */
  readonly thrustN?: number;
  readonly crewCapacity?: number;
  readonly attachesTo: SocketType;
  readonly sockets: readonly SocketDefinition[];
  /** Height of a stack section; also used by the renderer. */
  readonly heightM?: number;
  /** Rotation increment about the part's own Y axis; undefined means fixed orientation. */
  readonly rotationStepDeg?: number;
  /** Key into the renderer's procedural recipe table. */
  readonly visual: string;
  readonly unlock: UnlockStatus;
  readonly tags: readonly PartTag[];
}

export interface SocketRef {
  /** null means the assembly stand (the root slot). */
  readonly parentId: string | null;
  readonly socketId: string;
}

export interface PartInstance {
  readonly id: string;
  readonly partId: string;
  readonly parent: SocketRef;
  readonly rotationDeg: number;
}

export const BLUEPRINT_SCHEMA_VERSION = 1;

/** Parts are ordered so every parent precedes its children. */
export interface RocketBlueprint {
  readonly schemaVersion: typeof BLUEPRINT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nextInstanceNumber: number;
  readonly parts: readonly PartInstance[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };
