import type { HullFinish, VehicleRole } from './types';

/** Cosmetic hull finishes. They do not affect stats. */
export const HULL_FINISHES: readonly { id: HullFinish; name: string; description: string }[] = [
  { id: 'brushed', name: 'Brushed steel', description: 'Factory-fresh satin stainless.' },
  { id: 'polished', name: 'Mirror polish', description: 'High-gloss show finish for rollout day.' },
  {
    id: 'weathered',
    name: 'Flight-proven',
    description: 'Heat-tinted, soot-streaked veteran look.',
  },
];

export const VEHICLE_ROLES: readonly { id: VehicleRole; name: string; description: string }[] = [
  {
    id: 'cargo',
    name: 'Cargo',
    description: 'Uncrewed payload delivery. Fewer safety requirements.',
  },
  {
    id: 'crew',
    name: 'Crew',
    description: 'Carries people: needs a crew cabin, full heat shield and flaps.',
  },
];

export function isHullFinish(v: unknown): v is HullFinish {
  return HULL_FINISHES.some((f) => f.id === v);
}

export function isVehicleRole(v: unknown): v is VehicleRole {
  return VEHICLE_ROLES.some((r) => r.id === v);
}
