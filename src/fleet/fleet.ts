import { findPart } from '../rocket/catalog/parts';
import type { RocketBlueprint } from '../rocket/model/types';
import { instanceStages } from '../rocket/stats/calculateRocketStats';
import { stageSignature } from '../recovery/recoveryPlan';
import type { Grade } from '../recovery/rating';

/*
 * Recovered hardware. A recovered booster or ship joins the fleet with a flight count and wear;
 * flying it again costs a fraction of a new build. Wear grows with each flight (more after rough
 * landings or heavy heating), adds mission risk and eventually retires the vehicle. Refurbishing
 * resets wear for a one-off surcharge on the next flight. Game values throughout.
 */

export type HardwareKind = 'booster' | 'ship';

export interface FleetVehicle {
  readonly id: string;
  readonly kind: HardwareKind;
  /** Call sign, e.g. "B-3". */
  readonly name: string;
  readonly designId: string;
  readonly designName: string;
  /** Part-tree signature of the stage it was built as (see stageSignature). */
  readonly signature: string;
  readonly flights: number;
  /** 0 (new) .. 1 (worn out). */
  readonly wear: number;
  readonly lastGrade: Grade | null;
  readonly recoveredAt: string;
  /** Refurbished since its last flight: the next flight pays the refurbishment share. */
  readonly refurbPending: boolean;
}

export const FLEET = {
  /** Share of a new build's cost paid to refly, plus a wear-dependent part. */
  reflightBaseShare: 0.12,
  reflightWearShare: 0.4,
  refurbishShare: 0.3,
  /** "Rapid Reuse" tech: base reflight and refurbishment shares are scaled by this. */
  rapidReuseFactor: 0.6,
  wearPerFlight: { booster: 0.07, ship: 0.06 },
  gradeWear: { S: 0, A: 0.01, B: 0.03, C: 0.06, D: 0.1 } as Record<Grade, number>,
  /** Extra mission risk at full wear. */
  riskAtFullWear: 0.25,
  retireAt: 1,
  maxVehicles: 24,
} as const;

/** Cost of the parts that belong to one stage of a design (new build). */
export function stageCost(bp: RocketBlueprint, kind: HardwareKind): number {
  const stages = instanceStages(bp);
  return bp.parts
    .filter((p) => (stages.get(p.id) ?? 'booster') === kind)
    .reduce((s, p) => s + (findPart(p.partId)?.costCredits ?? 0), 0);
}

export function isRetired(v: FleetVehicle): boolean {
  return v.wear >= FLEET.retireAt;
}

/** Fleet vehicles that can fly as the given stage of a design. */
export function compatibleVehicles(
  fleet: readonly FleetVehicle[],
  bp: RocketBlueprint,
  kind: HardwareKind,
): FleetVehicle[] {
  const sig = stageSignature(bp, kind);
  return fleet.filter((v) => v.kind === kind && v.signature === sig && !isRetired(v));
}

/** Cost of flying this stage: new build, or reflight of a fleet vehicle. */
export function stageFlightCost(
  newCost: number,
  vehicle: FleetVehicle | null,
  rapidReuse = false,
): number {
  if (!vehicle) return newCost;
  const k = rapidReuse ? FLEET.rapidReuseFactor : 1;
  const share =
    k * FLEET.reflightBaseShare +
    FLEET.reflightWearShare * vehicle.wear +
    (vehicle.refurbPending ? k * FLEET.refurbishShare : 0);
  return Math.round(newCost * Math.min(1, share));
}

export function wearRisk(vehicle: FleetVehicle | null): number {
  return vehicle ? FLEET.riskAtFullWear * vehicle.wear : 0;
}

export interface RecoveryInput {
  readonly kind: HardwareKind;
  readonly bp: RocketBlueprint;
  readonly at: string;
  readonly grade: Grade | null;
  /** Extra wear from this flight's conditions (heating, ablation), 0..1. */
  readonly stress: number;
  /** The fleet vehicle that flew, if it was a reflight. */
  readonly reflownId: string | null;
}

function nextName(fleet: readonly FleetVehicle[], kind: HardwareKind): string {
  const prefix = kind === 'booster' ? 'B' : 'S';
  const used = fleet.filter((v) => v.kind === kind).map((v) => Number(v.name.split('-')[1]) || 0);
  return `${prefix}-${Math.max(0, ...used) + 1}`;
}

function flightWear(input: RecoveryInput): number {
  return (
    FLEET.wearPerFlight[input.kind] +
    (input.grade ? FLEET.gradeWear[input.grade] : 0.1) +
    Math.max(0, Math.min(1, input.stress)) * 0.2
  );
}

/** Records a recovered stage: updates the reflown vehicle or adds a new one. Pure. */
export function recordRecovery(
  fleet: readonly FleetVehicle[],
  input: RecoveryInput,
  newId: string,
): {
  fleet: FleetVehicle[];
  vehicle: FleetVehicle;
} {
  const existing = input.reflownId ? fleet.find((v) => v.id === input.reflownId) : undefined;
  const wear = flightWear(input);
  if (existing) {
    const vehicle: FleetVehicle = {
      ...existing,
      flights: existing.flights + 1,
      wear: Math.min(1, existing.wear + wear),
      lastGrade: input.grade,
      recoveredAt: input.at,
      refurbPending: false,
    };
    return { fleet: fleet.map((v) => (v.id === existing.id ? vehicle : v)), vehicle };
  }
  const vehicle: FleetVehicle = {
    id: newId,
    kind: input.kind,
    name: nextName(fleet, input.kind),
    designId: input.bp.id,
    designName: input.bp.name,
    signature: stageSignature(input.bp, input.kind),
    flights: 1,
    wear: Math.min(1, wear),
    lastGrade: input.grade,
    recoveredAt: input.at,
    refurbPending: false,
  };
  // Keep the fleet bounded: drop retired vehicles first, then the oldest.
  let all = [...fleet, vehicle];
  while (all.length > FLEET.maxVehicles) {
    const victim = all.find(isRetired) ?? all[0]!;
    all = all.filter((v) => v !== victim);
  }
  return { fleet: all, vehicle };
}

/** A reflown vehicle that was lost is removed from the fleet. Pure. */
export function recordLoss(fleet: readonly FleetVehicle[], id: string | null): FleetVehicle[] {
  return id ? fleet.filter((v) => v.id !== id) : [...fleet];
}

/** Refurbishment resets wear; the next flight pays the refurbishment share. Pure. */
export function refurbish(fleet: readonly FleetVehicle[], id: string): FleetVehicle[] {
  return fleet.map((v) => (v.id === id ? { ...v, wear: 0, refurbPending: true } : v));
}

/** Scraps a vehicle (removes it from the fleet). Pure. */
export function scrap(fleet: readonly FleetVehicle[], id: string): FleetVehicle[] {
  return fleet.filter((v) => v.id !== id);
}
