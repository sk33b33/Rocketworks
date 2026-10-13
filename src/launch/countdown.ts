/*
 * Launch countdown. The clock runs in "T-minus" seconds (negative before liftoff) and is
 * time-compressed for gameplay: 60× until T-1 min, 5× until T-10 s, then real time.
 */

export const COUNTDOWN_START_S = -40 * 60;
export const TERMINAL_COUNT_S = -10;

export interface CountdownStep {
  readonly id: string;
  /** Seconds relative to liftoff (negative = before). */
  readonly atS: number;
  readonly label: string;
  readonly detail: string;
  readonly crewed?: boolean;
}

export const COUNTDOWN_STEPS: readonly CountdownStep[] = [
  {
    id: 'power',
    atS: -40 * 60,
    label: 'Vehicle power-up',
    detail: 'Avionics on internal checkout; range reports GO.',
  },
  {
    id: 'booster-load',
    atS: -35 * 60,
    label: 'Booster propellant load',
    detail: 'Cryogenic methane and oxygen flow into the booster.',
  },
  {
    id: 'ship-load',
    atS: -32 * 60,
    label: 'Ship propellant load',
    detail: 'Ship tanks begin filling.',
  },
  {
    id: 'crew',
    atS: -25 * 60,
    label: 'Crew boarding',
    detail: 'Crew access arm extended; hatch closed.',
    crewed: true,
  },
  {
    id: 'closeout',
    atS: -25 * 60,
    label: 'Payload closeout',
    detail: 'Payload powered and bay doors locked.',
    crewed: false,
  },
  {
    id: 'load-complete',
    atS: -16 * 60,
    label: 'Propellant load complete',
    detail: 'Tanks topped off and pressurized.',
  },
  {
    id: 'chill',
    atS: -10 * 60,
    label: 'Engine chill',
    detail: 'Cold propellant conditions the engine turbopumps.',
  },
  {
    id: 'poll',
    atS: -5 * 60,
    label: 'Final GO / NO-GO poll',
    detail: 'Flight director polls every console.',
  },
  {
    id: 'tower',
    atS: -2 * 60,
    label: 'Tower arms retract',
    detail: 'Access arms swing clear of the vehicle.',
  },
  {
    id: 'autoseq',
    atS: -30,
    label: 'Autosequence start',
    detail: 'Computers take over the final count.',
  },
  {
    id: 'ignition',
    atS: -3,
    label: 'Engine ignition',
    detail: 'Engines start in sequence on the mount.',
  },
  { id: 'liftoff', atS: 0, label: 'Liftoff', detail: 'Hold-down clamps release.' },
];

export function stepsFor(crewed: boolean): CountdownStep[] {
  return COUNTDOWN_STEPS.filter((s) => s.crewed === undefined || s.crewed === crewed);
}

export function countdownRate(clockS: number): number {
  if (clockS < -60) return 60;
  if (clockS < TERMINAL_COUNT_S) return 5;
  return 1;
}

/** Advances the clock by a real-time delta, respecting rate boundaries. Never passes 0. */
export function advanceCountdown(clockS: number, realDtS: number): number {
  let clock = clockS;
  let remaining = Math.max(0, realDtS);
  while (remaining > 1e-9 && clock < 0) {
    const rate = countdownRate(clock);
    const boundary = clock < -60 ? -60 : clock < TERMINAL_COUNT_S ? TERMINAL_COUNT_S : 0;
    const realToBoundary = (boundary - clock) / rate;
    if (realToBoundary >= remaining) {
      clock += remaining * rate;
      remaining = 0;
    } else {
      clock = boundary;
      remaining -= realToBoundary;
    }
  }
  return Math.min(0, clock);
}

export type StepStatus = 'done' | 'active' | 'pending';

export function stepStatus(
  steps: readonly CountdownStep[],
  index: number,
  clockS: number,
): StepStatus {
  const step = steps[index];
  if (!step) return 'pending';
  const next = steps[index + 1];
  if (clockS >= step.atS && (!next || clockS >= next.atS)) return 'done';
  return clockS >= step.atS ? 'active' : 'pending';
}

/** Propellant loading progress (0..1) for display. */
export function propellantLoad(clockS: number): { booster: number; ship: number } {
  const frac = (start: number) => Math.min(1, Math.max(0, (clockS - start) / (-16 * 60 - start)));
  return { booster: frac(-35 * 60), ship: frac(-32 * 60) };
}

export function formatTMinus(clockS: number): string {
  const sign = clockS < 0 ? 'T-' : 'T+';
  const s = Math.abs(Math.round(clockS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${h ? `${h}:` : ''}${pad(m)}:${pad(sec)}`;
}
