import { rateLanding, type Grade } from '../recovery/rating';
import { STATION_N } from './stationOrbit';

/*
 * Proximity operations in the station frame (x = radial, y = along-track, z = cross-track; m).
 * Relative motion follows the Clohessy–Wiltshire equations, so a ship drifts the way it really
 * would near a station (it isn't a free-floating space). The ship translates with RCS and
 * aligns its nose docking port with the station's forward port, which faces +y. Contact at the
 * port is classified as a soft dock, a bounce or a collision. Game values throughout.
 */

export type Vec3 = readonly [number, number, number];

/** The station's forward docking port (station frame) and its approach axis (+y). */
export const PORT: Vec3 = [0, 31, 0];
/** Keep-out sphere around the station centre and the approach corridor half-angle. */
export const KEEP_OUT_M = 200;
export const CORRIDOR_HALF_ANGLE_DEG = 12;
/** Inside the keep-out sphere, closing speed must stay under 0.1 m/s + 1% of the range. */
export const closingLimitMS = (rangeToPort: number) => 0.1 + 0.01 * rangeToPort;
/** Leaving proximity operations is allowed beyond this range from the station. */
export const DEPART_RANGE_M = 300;

/** Soft-capture window at contact (game values). */
export const DOCK_WINDOW = {
  minClosingMS: 0.02,
  maxClosingMS: 0.35,
  offsetM: 0.3,
  angleDeg: 4,
  rollDeg: 5,
  lateralMS: 0.1,
} as const;
/** Contact above this closing speed is a collision (damage); below it but outside the window, a bounce. */
export const BOUNCE_MAX_MS = 0.8;

export const RCS = {
  /** Translation acceleration per axis (m/s²). */
  accelMS2: 0.12,
  /** Attitude angular acceleration (deg/s²) and the hold controller's rate limit. */
  angAccelDegS2: 1.5,
  maxRateDegS: 3,
  /** RCS Δv budget for proximity operations (m/s). */
  budgetMS: 40,
} as const;

/** Simplified station hull for collision checks: core modules along y and the truss along z. */
export function insideStation(p: Vec3): boolean {
  const [x, y, z] = p;
  const core = Math.abs(x) < 4.5 && Math.abs(z) < 4.5 && y > -45 && y < PORT[1];
  const truss = Math.abs(x) < 3 && Math.abs(y + 5) < 3 && Math.abs(z) < 55;
  const arrays = Math.abs(x) < 1 && Math.abs(y + 5) < 18 && Math.abs(z) > 30 && Math.abs(z) < 75;
  return core || truss || arrays;
}

export type ProxPhase = 'free' | 'docked' | 'destroyed';

export interface Attitude {
  /** Pointing errors of the nose from the port axis (deg) and roll error (deg). */
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

export interface ProxEvent {
  readonly tS: number;
  readonly kind: 'info' | 'warn' | 'fail' | 'success';
  readonly text: string;
}

export interface DockingResult {
  readonly grade: Grade;
  readonly closingMS: number;
  readonly offsetM: number;
  readonly angleDeg: number;
  readonly manual: boolean;
}

export interface ProxState {
  readonly tS: number;
  /** Ship docking-port position and velocity (station frame, rotating). */
  readonly p: Vec3;
  readonly v: Vec3;
  readonly att: Attitude;
  readonly attRate: Attitude;
  readonly rcsLeftMS: number;
  readonly hull: number;
  readonly phase: ProxPhase;
  readonly bounces: number;
  readonly collisions: number;
  /** Corridor/speed violations inside the keep-out sphere (counted on entry into violation). */
  readonly violations: number;
  readonly violating: boolean;
  readonly docking: DockingResult | null;
  readonly events: readonly ProxEvent[];
}

export interface ProxControls {
  /** Translation command per station axis, -1..1 (x radial, y along-track, z cross-track). */
  readonly translate: Vec3;
  /** Attitude torque command (pitch, yaw, roll), -1..1. */
  readonly rotate: Vec3;
  /** Attitude hold: null the rates (and, with `align`, the pointing errors). */
  readonly hold: boolean;
  readonly align: boolean;
}

export const NO_CONTROLS: ProxControls = {
  translate: [0, 0, 0],
  rotate: [0, 0, 0],
  hold: true,
  align: false,
};

export function initialProxState(p: Vec3, v: Vec3, tS: number, hull = 1): ProxState {
  return {
    tS,
    p,
    v,
    // The ship arrives roughly pointed at the station, not perfectly aligned.
    att: { pitch: 4, yaw: -3, roll: 6 },
    attRate: { pitch: 0, yaw: 0, roll: 0 },
    rcsLeftMS: RCS.budgetMS,
    hull,
    phase: 'free',
    bounces: 0,
    collisions: 0,
    violations: 0,
    violating: false,
    docking: null,
    events: [],
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Geometry of the approach relative to the port. */
export interface ApproachMetrics {
  /** Distance along the port axis (m, positive = in front of the port). */
  readonly alongM: number;
  /** Lateral offset from the port axis (m). */
  readonly lateralM: number;
  readonly rangeM: number;
  /** Closing speed toward the port (m/s, positive = approaching). */
  readonly closingMS: number;
  readonly lateralSpeedMS: number;
  readonly angleErrDeg: number;
  readonly rollErrDeg: number;
  /** Angle of the ship's position off the approach axis, seen from the port (deg). */
  readonly corridorDeg: number;
  readonly inKeepOut: boolean;
  readonly inCorridor: boolean;
}

export function approachMetrics(s: Pick<ProxState, 'p' | 'v' | 'att'>): ApproachMetrics {
  const q = sub(s.p, PORT);
  const lateral = Math.hypot(q[0], q[2]);
  const corridorDeg = (Math.atan2(lateral, Math.max(1e-6, q[1])) * 180) / Math.PI;
  const range = norm(s.p);
  return {
    alongM: q[1],
    lateralM: lateral,
    rangeM: range,
    closingMS: -s.v[1],
    lateralSpeedMS: Math.hypot(s.v[0], s.v[2]),
    angleErrDeg: Math.hypot(s.att.pitch, s.att.yaw),
    rollErrDeg: Math.abs(s.att.roll),
    corridorDeg: q[1] > 0 ? corridorDeg : 180,
    inKeepOut: range < KEEP_OUT_M,
    inCorridor: q[1] > 0 && corridorDeg <= CORRIDOR_HALF_ANGLE_DEG,
  };
}

/** Advances proximity operations by one fixed step. Pure. */
export function stepProximity(s: ProxState, c: ProxControls, dt: number, manual = true): ProxState {
  if (s.phase !== 'free') return { ...s, tS: s.tS + dt };
  const events: ProxEvent[] = [];
  const t = s.tS + dt;
  const n = STATION_N;

  // Attitude: torque commands, then the hold/align controller.
  const axis = (err: number, rate: number, cmd: number) => {
    let acc = cmd * RCS.angAccelDegS2;
    if (c.hold && cmd === 0) {
      const wantRate = c.align ? clamp(-err * 0.4, -RCS.maxRateDegS, RCS.maxRateDegS) : 0;
      acc = clamp((wantRate - rate) * 2, -RCS.angAccelDegS2, RCS.angAccelDegS2);
    }
    const r = clamp(rate + acc * dt, -RCS.maxRateDegS * 2, RCS.maxRateDegS * 2);
    return { e: err + r * dt, r };
  };
  const pAx = axis(s.att.pitch, s.attRate.pitch, c.rotate[0]);
  const yAx = axis(s.att.yaw, s.attRate.yaw, c.rotate[1]);
  const rAx = axis(s.att.roll, s.attRate.roll, c.rotate[2]);

  // Translation: RCS thrust within the budget, plus Clohessy–Wiltshire relative dynamics.
  const thrusting = s.rcsLeftMS > 0;
  const tr: Vec3 = thrusting
    ? (c.translate.map((u) => clamp(u, -1, 1) * RCS.accelMS2) as unknown as Vec3)
    : [0, 0, 0];
  const used = norm(tr) * dt;
  const [x, y, z] = s.p;
  const [vx, vy, vz] = s.v;
  const ax = 3 * n * n * x + 2 * n * vy + tr[0];
  const ay = -2 * n * vx + tr[1];
  const az = -n * n * z + tr[2];
  const v: Vec3 = [vx + ax * dt, vy + ay * dt, vz + az * dt];
  const p: Vec3 = [x + v[0] * dt, y + v[1] * dt, z + v[2] * dt];

  let next: ProxState = {
    ...s,
    tS: t,
    p,
    v,
    att: { pitch: pAx.e, yaw: yAx.e, roll: rAx.e },
    attRate: { pitch: pAx.r, yaw: yAx.r, roll: rAx.r },
    rcsLeftMS: Math.max(0, s.rcsLeftMS - used),
  };
  if (s.rcsLeftMS > 0 && next.rcsLeftMS <= 0)
    events.push({ tS: t, kind: 'warn', text: 'RCS propellant budget used up.' });

  // Keep-out sphere: inside it the ship must be in the corridor and slow.
  const m = approachMetrics(next);
  const violating =
    m.inKeepOut &&
    m.alongM > 1 &&
    (!m.inCorridor || m.closingMS > closingLimitMS(Math.hypot(m.alongM, m.lateralM)));
  if (violating && !s.violating) {
    events.push({
      tS: t,
      kind: 'warn',
      text: m.inCorridor
        ? `Closing too fast inside the keep-out sphere (${m.closingMS.toFixed(2)} m/s).`
        : 'Outside the approach corridor inside the keep-out sphere.',
    });
    next = { ...next, violations: next.violations + 1 };
  }
  next = { ...next, violating };

  // Contact at the port.
  const before = sub(s.p, PORT)[1];
  const after = m.alongM;
  if (before > 0 && after <= 0 && m.lateralM <= 1.5) {
    next = contact(next, m, events, t, manual);
  } else if (insideStation(p) && !insideStation(s.p)) {
    // Struck the station structure away from the port.
    const speed = norm(s.v);
    const damage = Math.min(1, 0.25 * Math.max(0.3, speed));
    events.push({
      tS: t,
      kind: 'fail',
      text: `Collision with the station structure at ${speed.toFixed(2)} m/s.`,
    });
    next = {
      ...next,
      p: s.p,
      v: [-s.v[0] * 0.3, -s.v[1] * 0.3, -s.v[2] * 0.3],
      hull: Math.max(0, next.hull - damage),
      collisions: next.collisions + 1,
    };
  }
  if (next.hull <= 0 && next.phase !== 'destroyed') {
    events.push({ tS: t, kind: 'fail', text: 'Hull breached in the collision: the ship is lost.' });
    next = { ...next, phase: 'destroyed' };
  }
  return events.length ? { ...next, events: [...s.events, ...events] } : next;
}

function contact(
  s: ProxState,
  m: ApproachMetrics,
  events: ProxEvent[],
  t: number,
  manual: boolean,
): ProxState {
  const ok =
    m.closingMS >= DOCK_WINDOW.minClosingMS &&
    m.closingMS <= DOCK_WINDOW.maxClosingMS &&
    m.lateralM <= DOCK_WINDOW.offsetM &&
    m.angleErrDeg <= DOCK_WINDOW.angleDeg &&
    m.rollErrDeg <= DOCK_WINDOW.rollDeg &&
    m.lateralSpeedMS <= DOCK_WINDOW.lateralMS;
  if (ok) {
    const grade = rateLanding(
      { missM: m.lateralM, vertMS: m.closingMS, horizMS: m.lateralSpeedMS, tiltDeg: m.angleErrDeg },
      {
        missM: DOCK_WINDOW.offsetM,
        vertMS: DOCK_WINDOW.maxClosingMS * 1.6,
        horizMS: DOCK_WINDOW.lateralMS,
        tiltDeg: DOCK_WINDOW.angleDeg,
      },
    ).grade;
    events.push({
      tS: t,
      kind: 'success',
      text: `Soft capture and hard dock (${m.closingMS.toFixed(2)} m/s, ${m.lateralM.toFixed(2)} m off, ${m.angleErrDeg.toFixed(1)}°).`,
    });
    return {
      ...s,
      p: PORT,
      v: [0, 0, 0],
      att: { pitch: 0, yaw: 0, roll: 0 },
      attRate: { pitch: 0, yaw: 0, roll: 0 },
      phase: 'docked',
      docking: {
        grade,
        closingMS: m.closingMS,
        offsetM: m.lateralM,
        angleDeg: m.angleErrDeg,
        manual,
      },
    };
  }
  const back: Vec3 = [s.v[0], Math.abs(s.v[1]) * 0.5 + 0.02, s.v[2]];
  const p: Vec3 = [s.p[0], PORT[1] + 0.05, s.p[2]];
  if (m.closingMS <= BOUNCE_MAX_MS) {
    const why =
      m.closingMS < DOCK_WINDOW.minClosingMS
        ? 'too slow to latch'
        : m.closingMS > DOCK_WINDOW.maxClosingMS
          ? `too fast (${m.closingMS.toFixed(2)} m/s)`
          : m.lateralM > DOCK_WINDOW.offsetM
            ? `${m.lateralM.toFixed(2)} m off centre`
            : m.angleErrDeg > DOCK_WINDOW.angleDeg
              ? `misaligned by ${m.angleErrDeg.toFixed(1)}°`
              : m.rollErrDeg > DOCK_WINDOW.rollDeg
                ? `rolled ${m.rollErrDeg.toFixed(1)}°`
                : 'drifting sideways';
    events.push({
      tS: t,
      kind: 'warn',
      text: `Contact without capture: ${why}. The ship bounced off.`,
    });
    return { ...s, p, v: back, bounces: s.bounces + 1 };
  }
  const damage = Math.min(1, 0.25 * m.closingMS);
  events.push({
    tS: t,
    kind: 'fail',
    text: `Hard collision at the port (${m.closingMS.toFixed(2)} m/s): hull damaged.`,
  });
  return { ...s, p, v: back, hull: Math.max(0, s.hull - damage), collisions: s.collisions + 1 };
}

/** Undock: spring away from the port at a gentle speed. Pure. */
export function undock(s: ProxState): ProxState {
  if (s.phase !== 'docked') return s;
  return {
    ...s,
    phase: 'free',
    p: [PORT[0], PORT[1] + 0.3, PORT[2]],
    v: [0, 0.12, 0],
    events: [
      ...s.events,
      { tS: s.tS, kind: 'info', text: 'Undocked: springs push the ship away.' },
    ],
  };
}

export type AssistMode = 'off' | 'dock' | 'abort';

/**
 * Docking assist: aligns the ship and flies the corridor to the port (or backs out to a safe
 * distance on abort). Returns translation/attitude commands for this step.
 */
export function assistControls(s: ProxState, mode: AssistMode): ProxControls {
  if (mode === 'off') return NO_CONTROLS;
  const q = sub(s.p, PORT);
  let want: Vec3;
  if (mode === 'abort') {
    // Back out along the approach axis to a safe departure distance.
    const target: Vec3 = [0, DEPART_RANGE_M + 40, 0];
    const d = sub(target, s.p);
    const dist = norm(d);
    const speed = Math.min(1, dist * 0.02);
    want =
      dist > 1 ? [(d[0] / dist) * speed, (d[1] / dist) * speed, (d[2] / dist) * speed] : [0, 0, 0];
  } else {
    const lateral = Math.hypot(q[0], q[2]);
    // First centre on the axis (holding the along-track distance), then close in slowly.
    const lateralWant = (u: number) => clamp(-u * 0.03, -0.6, 0.6);
    const centred = lateral < 0.15 + q[1] * 0.02;
    const closing = centred ? clamp(0.012 * q[1] + 0.06, 0.06, 2.5) : 0;
    want = [
      lateralWant(q[0]),
      q[1] > 0 ? -Math.min(closing, closingLimitMS(Math.max(0, q[1])) * 0.8 + 0.03) : 0.1,
      lateralWant(q[2]),
    ];
  }
  const cmd = (w: number, v: number) => {
    const e = w - v;
    return Math.abs(e) < 0.004 ? 0 : clamp(e / (RCS.accelMS2 * 0.5), -1, 1);
  };
  return {
    translate: [cmd(want[0], s.v[0]), cmd(want[1], s.v[1]), cmd(want[2], s.v[2])],
    rotate: [0, 0, 0],
    hold: true,
    align: true,
  };
}

/** Docked tasks (crew transfer, cargo, experiment) run in parallel over simulated time. */
export interface StationTask {
  readonly id: string;
  readonly label: string;
  readonly durationS: number;
}

export function stationTasks(crew: number, cargo: boolean): StationTask[] {
  const tasks: StationTask[] = [
    { id: 'leak-check', label: 'Leak checks and hatch opening', durationS: 1_800 },
    { id: 'experiment', label: 'Run the microgravity experiment', durationS: 4 * 3_600 },
  ];
  if (crew > 0)
    tasks.push({ id: 'crew', label: `Crew handover (${crew} aboard)`, durationS: 3 * 3_600 });
  if (cargo) tasks.push({ id: 'cargo', label: 'Unload supplies', durationS: 2 * 3_600 });
  return tasks;
}

/** 0..1 progress of each task after `dockedS` seconds docked (leak checks gate the rest). */
export function taskProgress(tasks: readonly StationTask[], dockedS: number): number[] {
  const gate = tasks.find((t) => t.id === 'leak-check')?.durationS ?? 0;
  return tasks.map((t) =>
    t.id === 'leak-check'
      ? clamp(dockedS / t.durationS, 0, 1)
      : clamp((dockedS - gate) / t.durationS, 0, 1),
  );
}
