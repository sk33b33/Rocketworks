import { hashString, mulberry32 } from '../shared/random';

/*
 * Launch window and weather, generated deterministically from a seed. These are gameplay
 * modifiers inspired by real launch-commit criteria, not forecasts or real limits.
 */

export type ConditionStatus = 'green' | 'amber' | 'red';

export interface ConditionFactor {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly limit: string;
  readonly status: ConditionStatus;
  readonly note: string;
}

export interface LaunchConditions {
  readonly seed: number;
  readonly windowOpensInHours: number;
  readonly windowMinutes: number;
  readonly factors: readonly ConditionFactor[];
  readonly overall: ConditionStatus;
}

export function initialConditionsSeed(missionId: string): number {
  return hashString(`window:${missionId}`);
}

const worst = (a: ConditionStatus, b: ConditionStatus): ConditionStatus =>
  a === 'red' || b === 'red' ? 'red' : a === 'amber' || b === 'amber' ? 'amber' : 'green';

export function generateConditions(seed: number): LaunchConditions {
  const rng = mulberry32(seed);
  const wind = Math.round(4 + rng() * 32);
  const shear = Math.round(rng() * 100);
  const ceiling = Math.round(1 + rng() * 11) * 1000;
  const lightning = rng() < 0.14;
  const sea = 1 + Math.floor(rng() * 6);
  const windowOpensInHours = 1 + Math.floor(rng() * 18);
  const windowMinutes = 30 + Math.floor(rng() * 7) * 15;

  const factors: ConditionFactor[] = [
    {
      id: 'wind',
      label: 'Surface wind',
      value: `${wind} kt`,
      limit: '≤ 22 kt go · > 30 kt no-go',
      status: wind > 30 ? 'red' : wind > 22 ? 'amber' : 'green',
      note: 'Strong ground winds load the stack on the pad and during tower clear.',
    },
    {
      id: 'shear',
      label: 'Upper-level wind shear',
      value: `${shear}% of limit`,
      limit: '≤ 70% go · > 90% no-go',
      status: shear > 90 ? 'red' : shear > 70 ? 'amber' : 'green',
      note: 'High shear raises structural loads around max-Q.',
    },
    {
      id: 'lightning',
      label: 'Lightning within 10 nmi',
      value: lightning ? 'Detected' : 'None',
      limit: 'None',
      status: lightning ? 'red' : 'green',
      note: 'Launching through electrified clouds can trigger lightning strikes.',
    },
    {
      id: 'ceiling',
      label: 'Cloud ceiling',
      value: `${ceiling.toLocaleString('en-US')} ft`,
      limit: '≥ 4,000 ft for tracking cameras',
      status: ceiling < 4000 ? 'amber' : 'green',
      note: 'Low clouds hide the vehicle from optical tracking.',
    },
    {
      id: 'sea',
      label: 'Recovery-zone sea state',
      value: `${sea} / 6`,
      limit: '≤ 4 for recovery operations',
      status: sea > 4 ? 'amber' : 'green',
      note: 'Rough seas complicate recovery and abort retrieval.',
    },
  ];
  const overall = factors.reduce<ConditionStatus>((acc, f) => worst(acc, f.status), 'green');
  return { seed, windowOpensInHours, windowMinutes, factors, overall };
}

/** The next window: a new deterministic draw. Waiting costs nothing in this stage. */
export function nextWindowSeed(seed: number): number {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + 1) >>> 0;
}
