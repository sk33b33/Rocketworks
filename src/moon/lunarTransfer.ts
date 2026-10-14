import { EARTH_MU_M3S2, G0_MS2 } from '../simulation/constants';
import { FLIGHT, stepFlight, type FlightState, type ShipSpec } from '../flight/flightModel';
import { BELLY_AOA_DEG, CIRCULAR_TARGET_PE_M } from '../flight/autopilot';
import { dot, localFrame, orbitalElements, type OrbitBody, type Vec2 } from '../flight/orbitMath';
import {
  bodyFrame,
  MOON_DISTANCE_M,
  MOON_MU_M3S2,
  MOON_RADIUS_M,
  moonState,
  type GravityEnv,
} from './moonOrbit';
import {
  coastStep,
  coastDt,
  predictLunarPass,
  predictReturn,
  SCAN_DT_DIVISOR,
  SIM_DT_DIVISOR,
  type CoastState,
  type LunarPass,
  type ReturnLeg,
} from './propagate';

/*
 * Assisted guidance between Earth and the Moon (gameplay guidance, not flight software):
 *   translunar — plan and fly trans-lunar injection from the parking orbit, then mid-course
 *                corrections toward a capture pass (lunar missions) or a free return (flyby);
 *   lunar-orbit — lunar orbit insertion: a retrograde burn around closest approach;
 *   trans-earth — trans-Earth injection from lunar orbit (or the coast home after a flyby) with
 *                corrections toward an aerocapture perigee;
 *   aerocapture — one braking pass through the upper atmosphere into an elliptical Earth orbit,
 *                after which the regular circularize/deorbit programs bring the ship home.
 * Plans use numerical prediction in the same Earth–Moon model the flight runs in.
 */

export const MOON_BODY: OrbitBody = {
  mu: MOON_MU_M3S2,
  radiusM: MOON_RADIUS_M,
  stablePeriapsisM: 15_000,
};

/** Target closest approach for lunar orbit insertion (altitude, clockwise pass). */
export const LOI_PERILUNE_M = 110_000;
/** Insertion stops once the orbit's high point is below this. */
export const LOI_APOLUNE_M = 200_000;
/** Free-return flybys pass the Moon anticlockwise at about this altitude (initial aim). */
export const FLYBY_AIM_ALT_M = 8_000_000;
/** Return perigee aimed for the aerocapture pass, and the orbit it should leave the ship in. */
export const AEROCAPTURE_PERIGEE_M = 70_000;
export const AEROCAPTURE_APOGEE_M = 300_000;
/** Trans-lunar injection aims for an Earth orbit reaching this far (a faster-than-Hohmann transfer). */
const TLI_APOGEE_M = 1.2 * MOON_DISTANCE_M;
const MCC_FIRST_DELAY_S = 2 * 3_600;
const MCC_BEFORE_ARRIVAL_S = 15 * 3_600;
/** Corrections smaller than this are skipped (m/s). */
const MCC_MIN_DV = 0.4;

export type LunarProgramId = 'translunar' | 'lunar-orbit' | 'trans-earth' | 'aerocapture';
export type LunarGoal = 'capture' | 'flyby';

export type TransferPhase = 'plan' | 'wait' | 'burn' | 'coast' | 'mcc-burn' | 'done';

export interface LunarGuidance {
  readonly program: LunarProgramId | 'none';
  readonly goal: LunarGoal;
  readonly phase: TransferPhase;
  /** Planned impulse time and the energy (relative to the burn's body) that ends the burn. */
  readonly burnT: number | null;
  readonly burnStartT: number | null;
  readonly targetEnergy: number | null;
  readonly plannedDvMS: number | null;
  /** Next correction time, the burn direction (inertial unit vector) and size. */
  readonly mccT: number | null;
  readonly mccCount: number;
  readonly mccDir: Vec2 | null;
  readonly mccDvMS: number;
  readonly deliveredMS: number;
  readonly prev: { readonly v: Vec2; readonly r: Vec2; readonly tS: number } | null;
  /** Latest prediction, for the HUD. */
  readonly pass: LunarPass | null;
  readonly ret: ReturnLeg | null;
  readonly predictedAt: number;
  /** Aerocapture: bank commanded and whether the pass has started. */
  readonly bankDeg: number;
  readonly dipped: boolean;
  readonly lastEccentricity?: number;
}

export const LUNAR_IDLE: LunarGuidance = {
  program: 'none',
  goal: 'capture',
  phase: 'plan',
  burnT: null,
  burnStartT: null,
  targetEnergy: null,
  plannedDvMS: null,
  mccT: null,
  mccCount: 0,
  mccDir: null,
  mccDvMS: 0,
  deliveredMS: 0,
  prev: null,
  pass: null,
  ret: null,
  predictedAt: -Infinity,
  bankDeg: 0,
  dipped: false,
};

export const LUNAR_PROGRAM_LABELS: Record<LunarProgramId, string> = {
  translunar: 'Trans-lunar injection',
  'lunar-orbit': 'Lunar orbit insertion',
  'trans-earth': 'Return to Earth',
  aerocapture: 'Aerocapture',
};

export const TRANSFER_PHASE_LABELS: Record<TransferPhase, string> = {
  plan: 'Planning',
  wait: 'Waiting for the burn',
  burn: 'Burning',
  coast: 'Coasting',
  'mcc-burn': 'Course correction burn',
  done: 'Complete',
};

export function startLunarProgram(program: LunarProgramId, goal: LunarGoal): LunarGuidance {
  return { ...LUNAR_IDLE, program, goal };
}

export interface LunarOutput {
  readonly controls: { targetPitchDeg: number; bankDeg: number; throttle: number };
  readonly next: LunarGuidance;
  readonly message?: string;
  /** Program finished: what to run next ('none' = autopilot off). */
  readonly chain?: LunarProgramId | 'circularize' | 'reentry' | 'none';
}

// ---- small helpers ----

const energyOf = (r: Vec2, v: Vec2, mu: number) =>
  (v[0] * v[0] + v[1] * v[1]) / 2 - mu / Math.hypot(r[0], r[1]);

/** Pitch (deg) in the ship's reference frame that points the nose along an inertial direction. */
export function pitchToward(dir: Vec2, s: FlightState, env: GravityEnv): number {
  const f = bodyFrame(s.ref ?? 'earth', s.r, s.v, s.tS, env);
  return (Math.atan2(dot(dir, f.up), dot(dir, f.east)) * 180) / Math.PI;
}

const aligned = (s: FlightState, pitch: number, tol = 3) =>
  Math.abs(((pitch - s.pitchDeg + 540) % 360) - 180) < tol;

const unit = (v: Vec2): Vec2 => {
  const m = Math.hypot(v[0], v[1]);
  return m > 0 ? [v[0] / m, v[1] / m] : [0, 0];
};

/** Velocity relative to Earth or the Moon. */
function relVelocity(s: CoastState, body: 'earth' | 'moon', env: GravityEnv): Vec2 {
  if (body === 'earth') return s.v;
  const m = moonState(env.moon, s.tS);
  return [s.v[0] - m.v[0], s.v[1] - m.v[1]];
}
function relPosition(s: CoastState, body: 'earth' | 'moon', env: GravityEnv): Vec2 {
  if (body === 'earth') return s.r;
  const m = moonState(env.moon, s.tS);
  return [s.r[0] - m.r[0], s.r[1] - m.r[1]];
}

/** Burn time (s) for a Δv with the ship's engines at full (governed) thrust. */
export function burnDurationS(spec: ShipSpec, propKg: number, dv: number): number {
  const st = spec.stage;
  const m0 = st.dryMassKg + propKg;
  const ve = st.ispVacS * G0_MS2;
  const m1 = m0 * Math.exp(-dv / ve);
  const thrust = Math.min(st.engineCount * st.thrustVacPerEngineN, FLIGHT.maxThrustG * G0_MS2 * m1);
  return ((m0 - m1) * ve) / Math.max(1, thrust);
}

/** Coasts a state forward by `dt` (planning helper). */
function coastFor(s: CoastState, dt: number, env: GravityEnv, divisor: number): CoastState {
  let x = s;
  const end = s.tS + dt;
  while (x.tS < end - 1e-6) {
    const h = Math.min(coastDt(x.r, x.tS, env, divisor), end - x.tS);
    x = coastStep(x, h, env);
  }
  return x;
}

/** Bisection on a scalar function with a known sign change. */
function bisect(
  f: (x: number) => number | null,
  a: number,
  b: number,
  fa: number,
  iterations: number,
): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === null) break;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Scans `xs` for a sign change of `f` (skipping nulls and jumps larger than `maxJump`), then
 * bisects it with the finer `fine` function. Returns the root nearest the start of the scan.
 */
function findRoot(
  xs: number[],
  coarse: (x: number) => number | null,
  fine: (x: number) => number | null,
  maxJump: number,
  iterations = 9,
): number | null {
  let prevX: number | null = null;
  let prevF: number | null = null;
  for (const x of xs) {
    const fx = coarse(x);
    if (fx !== null && prevF !== null && prevX !== null) {
      if (Math.sign(fx) !== Math.sign(prevF) && Math.abs(fx - prevF) < maxJump) {
        const fa = fine(prevX) ?? prevF;
        return bisect(fine, prevX, x, fa, iterations);
      }
    }
    prevX = x;
    prevF = fx;
  }
  return null;
}

// ---- metrics ----

/** How far a predicted pass is from the goal (m; zero = on target). */
function passMetric(goal: LunarGoal, p: LunarPass | null): number | null {
  if (!p) return null;
  if (goal === 'capture') return p.signedMissM - (MOON_RADIUS_M + LOI_PERILUNE_M);
  // Free return: anticlockwise pass, judged by where it brings the ship back.
  if (p.sense !== -1 || !p.after) return null;
  return p.after.perigeeAltM - AEROCAPTURE_PERIGEE_M;
}

// ---- planning ----

export interface BurnPlan {
  readonly burnT: number;
  readonly dvMS: number;
  readonly targetEnergy: number;
}

/** Plans trans-lunar injection from a near-circular parking orbit. */
export function planTli(s: FlightState, goal: LunarGoal, env: GravityEnv): BurnPlan | null {
  const el = orbitalElements(s.r, s.v);
  if (el.status !== 'orbit' || !Number.isFinite(el.periodS)) return null;
  const start: CoastState = { r: s.r, v: s.v, tS: s.tS };
  const leadS = 120; // leave time to turn and start the burn
  const impulse = (c: CoastState) => {
    const r = Math.hypot(c.r[0], c.r[1]);
    const want = Math.sqrt(EARTH_MU_M3S2 * (2 / r - 2 / (r + TLI_APOGEE_M)));
    const vHat = unit(c.v);
    const dv = want - Math.hypot(c.v[0], c.v[1]);
    return { dv, after: { ...c, v: [c.v[0] + vHat[0] * dv, c.v[1] + vHat[1] * dv] as Vec2 } };
  };
  const at = (dt: number, divisor: number) => coastFor(start, leadS + dt, env, divisor);
  // Aim the burn at a capture pass, or at a wide anticlockwise pass for a free return (the
  // corrections then tune the return perigee).
  const aim =
    goal === 'capture' ? MOON_RADIUS_M + LOI_PERILUNE_M : -(MOON_RADIUS_M + FLYBY_AIM_ALT_M);
  const metric = (dt: number, divisor: number) => {
    // Only the direct (outbound) branch: arrivals within 4.5 days.
    const p = predictLunarPass(impulse(at(dt, divisor)).after, env, {
      divisor,
      maxS: 4.5 * 86_400,
    });
    return p ? p.signedMissM - aim : null;
  };
  const xs = Array.from({ length: 49 }, (_, i) => (i * el.periodS) / 48);
  const root = findRoot(
    xs,
    (x) => metric(x, SCAN_DT_DIVISOR),
    (x) => metric(x, SIM_DT_DIVISOR),
    40_000_000,
  );
  if (root === null) return null;
  const c = at(root, SIM_DT_DIVISOR);
  const imp = impulse(c);
  return {
    burnT: c.tS,
    dvMS: imp.dv,
    targetEnergy: energyOf(imp.after.r, imp.after.v, EARTH_MU_M3S2),
  };
}

/** Plans trans-Earth injection from lunar orbit (return perigee at the aerocapture height). */
export function planTei(s: FlightState, env: GravityEnv): BurnPlan | null {
  const start: CoastState = { r: s.r, v: s.v, tS: s.tS };
  const rel = relPosition(start, 'moon', env);
  const vr = relVelocity(start, 'moon', env);
  const el = orbitalElements(rel, vr, MOON_BODY);
  if (el.status !== 'orbit' || !Number.isFinite(el.periodS)) return null;
  const leadS = 120;
  for (const dv of [850, 950, 1_050, 1_200]) {
    const impulse = (c: CoastState): CoastState => {
      const vHat = unit(relVelocity(c, 'moon', env));
      return { ...c, v: [c.v[0] + vHat[0] * dv, c.v[1] + vHat[1] * dv] };
    };
    const at = (dt: number, divisor: number) => coastFor(start, leadS + dt, env, divisor);
    const metric = (dt: number, divisor: number) => {
      const ret = predictReturn(impulse(at(dt, divisor)), env, { divisor, maxS: 7 * 86_400 });
      return ret ? ret.perigeeAltM - AEROCAPTURE_PERIGEE_M : null;
    };
    const xs = Array.from({ length: 37 }, (_, i) => (i * el.periodS) / 36);
    const root = findRoot(
      xs,
      (x) => metric(x, SCAN_DT_DIVISOR),
      (x) => metric(x, SIM_DT_DIVISOR),
      20_000_000,
    );
    if (root === null) continue;
    const c = at(root, SIM_DT_DIVISOR);
    const after = impulse(c);
    return {
      burnT: c.tS,
      dvMS: dv,
      targetEnergy: energyOf(
        relPosition(after, 'moon', env),
        relVelocity(after, 'moon', env),
        MOON_MU_M3S2,
      ),
    };
  }
  return null;
}

/**
 * Solves a course correction: the Δv (m/s) along the velocity (or radially, if that fails) that
 * zeroes `metric` for the coast from `s`. Returns the inertial Δv vector or null.
 */
export function solveCorrection(
  s: CoastState,
  env: GravityEnv,
  body: 'earth' | 'moon',
  metric: (s: CoastState, divisor: number) => number | null,
): Vec2 | null {
  const vHat = unit(relVelocity(s, body, env));
  const rHat = unit(relPosition(s, body, env));
  const base = metric(s, SIM_DT_DIVISOR);
  if (base !== null && Math.abs(base) < 5_000) return [0, 0];
  for (const [dir, span] of [
    [vHat, 30],
    [rHat, 30],
    [vHat, 120],
    [rHat, 120],
  ] as const) {
    const apply = (dv: number): CoastState => ({
      ...s,
      v: [s.v[0] + dir[0] * dv, s.v[1] + dir[1] * dv],
    });
    // Search outward from zero so the smallest correction wins.
    const steps = 12;
    const xs: number[] = [0];
    for (let i = 1; i <= steps; i++) xs.push((i * span) / steps, (-i * span) / steps);
    let best: number | null = null;
    // Positive and negative branches separately (each must be contiguous for the scan).
    for (const sign of [1, -1]) {
      const branch = [0, ...xs.filter((x) => Math.sign(x) === sign)];
      const root = findRoot(
        branch,
        (x) => metric(apply(x), SCAN_DT_DIVISOR),
        (x) => metric(apply(x), SIM_DT_DIVISOR),
        1e12,
        12,
      );
      if (root !== null && (best === null || Math.abs(root) < Math.abs(best))) best = root;
    }
    if (best !== null) return [dir[0] * best, dir[1] * best];
  }
  return null;
}

// ---- execution ----

/** Runs the active lunar program for one step. */
export function runLunarProgram(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
): LunarOutput {
  switch (g.program) {
    case 'translunar':
      return runTranslunar(g, s, spec, env);
    case 'lunar-orbit':
      return runInsertion(g, s, spec, env);
    case 'trans-earth':
      return runTransEarth(g, s, spec, env);
    case 'aerocapture':
      return runAerocapture(g, s, spec);
    default:
      return { controls: hold(s), next: g, chain: 'none' };
  }
}

const hold = (s: FlightState) => ({ targetPitchDeg: s.pitchDeg, bankDeg: 0, throttle: 0 });

/** Burns along a planned direction until the delivered Δv reaches the plan. */
function correctionBurn(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
): LunarOutput {
  const dir = g.mccDir ?? [0, 0];
  const pitch = pitchToward(dir, s, env);
  let delivered = g.deliveredMS;
  if (g.prev && s.tS > g.prev.tS) {
    // Delivered Δv: velocity change minus what gravity did over the step.
    const dt = s.tS - g.prev.tS;
    const a = gravityAt(g.prev.r, g.prev.tS, env);
    const dv: Vec2 = [s.v[0] - g.prev.v[0] - a[0] * dt, s.v[1] - g.prev.v[1] - a[1] * dt];
    delivered += Math.max(0, dot(dv, dir));
  }
  const left = g.mccDvMS - delivered;
  if (left <= 0.05 || s.propKg <= 0) {
    return {
      controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: 0 },
      next: { ...g, phase: 'coast', deliveredMS: delivered, prev: null, mccDir: null },
      message: `Course correction complete (${delivered.toFixed(1)} m/s).`,
    };
  }
  const mass = spec.stage.dryMassKg + s.propKg;
  const full = spec.stage.engineCount * spec.stage.thrustVacPerEngineN;
  // Small corrections: one engine at minimum; the model enforces the floor.
  const want = Math.min(1, (left * 2 * mass) / full);
  return {
    controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: aligned(s, pitch, 2) ? want : 0 },
    next: { ...g, deliveredMS: delivered, prev: { v: s.v, r: s.r, tS: s.tS } },
  };
}

function gravityAt(r: Vec2, tS: number, env: GravityEnv): Vec2 {
  // Same gravity the model applies (imported lazily to keep this file's surface small).
  const m = moonState(env.moon, tS);
  const rE = Math.hypot(r[0], r[1]);
  const d: Vec2 = [r[0] - m.r[0], r[1] - m.r[1]];
  const dM = Math.hypot(d[0], d[1]);
  const kE = -EARTH_MU_M3S2 / rE ** 3;
  const kM = -MOON_MU_M3S2 / dM ** 3;
  const kI = -MOON_MU_M3S2 / MOON_DISTANCE_M ** 3;
  return [kE * r[0] + kM * d[0] + kI * m.r[0], kE * r[1] + kM * d[1] + kI * m.r[1]];
}

/** Schedules or runs a mid-course correction during a coast. */
function coastWithCorrections(
  g: LunarGuidance,
  s: FlightState,
  env: GravityEnv,
  body: 'earth' | 'moon',
  metric: (c: CoastState, divisor: number) => number | null,
  arrivalT: number | null,
  coastPitch: number,
): LunarOutput {
  if (g.mccT !== null && s.tS >= g.mccT) {
    const here: CoastState = { r: s.r, v: s.v, tS: s.tS };
    const dv = solveCorrection(here, env, body, metric);
    const next = arrivalT !== null && g.mccCount === 0 ? arrivalT - MCC_BEFORE_ARRIVAL_S : null;
    const scheduled = next !== null && next > s.tS + 1_800 ? next : null;
    if (!dv) {
      return {
        controls: hold(s),
        next: { ...g, mccT: scheduled, mccCount: g.mccCount + 1 },
        message: 'No course correction found: holding the current trajectory.',
      };
    }
    const size = Math.hypot(dv[0], dv[1]);
    if (size < MCC_MIN_DV) {
      return {
        controls: hold(s),
        next: { ...g, mccT: scheduled, mccCount: g.mccCount + 1 },
        message: 'On course: correction not needed.',
      };
    }
    return {
      controls: hold(s),
      next: {
        ...g,
        phase: 'mcc-burn',
        mccT: scheduled,
        mccCount: g.mccCount + 1,
        mccDir: unit(dv),
        mccDvMS: size,
        deliveredMS: 0,
        prev: null,
      },
      message: `Course correction: ${size.toFixed(1)} m/s.`,
    };
  }
  return { controls: { targetPitchDeg: coastPitch, bankDeg: 0, throttle: 0 }, next: g };
}

/** Plan → wait → burn until the planned energy is reached. */
function runInjection(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
  body: 'earth' | 'moon',
  plan: () => BurnPlan | null,
  label: string,
): LunarOutput | null {
  const vRel = relVelocity(s, body, env);
  const pitch = pitchToward(unit(vRel), s, env);
  if (g.phase === 'plan') {
    const p = plan();
    if (!p) {
      return {
        controls: hold(s),
        next: { ...g, phase: 'done' },
        message: `Couldn't plan the ${label}: check the orbit.`,
        chain: 'none',
      };
    }
    const tau = burnDurationS(spec, s.propKg, p.dvMS);
    return {
      controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: 0 },
      next: {
        ...g,
        phase: 'wait',
        burnT: p.burnT,
        burnStartT: p.burnT - tau / 2,
        targetEnergy: p.targetEnergy,
        plannedDvMS: p.dvMS,
      },
      message: `${label[0]!.toUpperCase()}${label.slice(1)} planned: ${Math.round(p.dvMS)} m/s in ${formatIn(p.burnT - tau / 2 - s.tS)}.`,
    };
  }
  if (g.phase === 'wait') {
    if (g.burnStartT !== null && s.tS >= g.burnStartT) {
      if (s.tS > g.burnStartT + 30) return { controls: hold(s), next: { ...g, phase: 'plan' } };
      return {
        controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: aligned(s, pitch) ? 1 : 0 },
        next: { ...g, phase: 'burn' },
        message: `${label[0]!.toUpperCase()}${label.slice(1)} burn.`,
      };
    }
    return { controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: 0 }, next: g };
  }
  if (g.phase === 'burn') {
    const e = energyOf(
      relPosition(s, body, env),
      vRel,
      body === 'earth' ? EARTH_MU_M3S2 : MOON_MU_M3S2,
    );
    if (g.targetEnergy !== null && e >= g.targetEnergy) {
      return {
        controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: 0 },
        next: { ...g, phase: 'coast', mccT: s.tS + MCC_FIRST_DELAY_S, mccCount: 0 },
        message: `${label[0]!.toUpperCase()}${label.slice(1)} complete.`,
      };
    }
    if (s.propKg <= 0)
      return {
        controls: hold(s),
        next: { ...g, phase: 'coast', mccT: null },
        message: 'Propellant depleted during the burn.',
      };
    return { controls: { targetPitchDeg: pitch, bankDeg: 0, throttle: 1 }, next: g };
  }
  return null;
}

function runTranslunar(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
): LunarOutput {
  const inj = runInjection(
    g,
    s,
    spec,
    env,
    'earth',
    () => planTli(s, g.goal, env),
    'trans-lunar injection',
  );
  if (inj) return inj;
  if (g.phase === 'mcc-burn') return correctionBurn(g, s, spec, env);
  // Coasting toward the Moon.
  const metric = (c: CoastState, divisor: number) =>
    passMetric(
      g.goal,
      predictLunarPass(c, env, { divisor, withReturn: g.goal === 'flyby', maxS: 7 * 86_400 }),
    );
  let next = g;
  if (s.tS - g.predictedAt > 1_800) {
    const p = predictLunarPass({ r: s.r, v: s.v, tS: s.tS }, env, {
      divisor: SCAN_DT_DIVISOR,
      withReturn: g.goal === 'flyby',
      maxS: 7 * 86_400,
    });
    next = { ...g, pass: p, ret: p?.after ?? null, predictedAt: s.tS };
  }
  const moonRel = relPosition(s, 'moon', env);
  const moonVel = relVelocity(s, 'moon', env);
  const closing = dot(moonRel, moonVel) < 0;
  // Arrival: hand over near the Moon.
  if (s.ref === 'moon' && g.phase === 'coast' && g.mccT === null) {
    if (g.goal === 'capture' && closing) {
      return {
        controls: hold(s),
        next: { ...startLunarProgram('lunar-orbit', 'capture'), phase: 'coast' },
        message: 'Approaching the Moon: lunar orbit insertion engaged.',
        chain: 'lunar-orbit',
      };
    }
    if (g.goal === 'flyby' && !closing) {
      return {
        controls: hold(s),
        next: {
          ...startLunarProgram('trans-earth', 'flyby'),
          phase: 'coast',
          mccT: s.tS + 6 * 3_600,
        },
        message: 'Flyby complete: coasting home on the free return.',
        chain: 'trans-earth',
      };
    }
  }
  const arrival = next.pass?.periT ?? null;
  return coastWithCorrections(
    next,
    s,
    env,
    'earth',
    metric,
    arrival,
    pitchToward(unit(s.v), s, env),
  );
}

/** Time to periapsis (s) of the conic through (r, v) about `mu`; negative once past it. */
export function timeToPeriapsis(r: Vec2, v: Vec2, mu: number): number {
  const rMag = Math.hypot(r[0], r[1]);
  const v2 = v[0] * v[0] + v[1] * v[1];
  const energy = v2 / 2 - mu / rMag;
  const a = -mu / (2 * energy);
  const rv = dot(r, v);
  const e = Math.sqrt(Math.max(0, (1 - rMag / a) ** 2 + (rv * rv) / (mu * a)));
  if (energy < 0) {
    const E = Math.atan2(rv / Math.sqrt(mu * a), 1 - rMag / a);
    const M = E - e * Math.sin(E);
    return -M / Math.sqrt(mu / a ** 3);
  }
  const aa = -a;
  const F = Math.asinh(rv / (e * Math.sqrt(mu * aa)));
  const M = e * Math.sinh(F) - F;
  return -M / Math.sqrt(mu / aa ** 3);
}

function runInsertion(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
): LunarOutput {
  const rel = relPosition(s, 'moon', env);
  const vRel = relVelocity(s, 'moon', env);
  const el = orbitalElements(rel, vRel, MOON_BODY);
  const retro = pitchToward(unit([-vRel[0], -vRel[1]]), s, env);
  if (g.phase === 'burn') {
    const rising =
      g.lastEccentricity !== undefined &&
      el.eccentricity > g.lastEccentricity + 1e-6 &&
      el.status === 'orbit';
    if ((el.status === 'orbit' && el.apoapsisAltM <= LOI_APOLUNE_M) || rising || s.propKg <= 0) {
      return {
        controls: { targetPitchDeg: retro, bankDeg: 0, throttle: 0 },
        next: { ...g, phase: 'done' },
        message:
          el.status === 'orbit'
            ? `Lunar orbit: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km.`
            : 'Insertion burn ended without a stable lunar orbit.',
        chain: 'none',
      };
    }
    return {
      controls: { targetPitchDeg: retro, bankDeg: 0, throttle: 1 },
      next: { ...g, lastEccentricity: el.eccentricity },
    };
  }
  // Approach: start the burn so it is centred on closest approach.
  const toPeri = timeToPeriapsis(rel, vRel, MOON_MU_M3S2);
  const vPeri = Math.sqrt(
    Math.max(0, 2 * (el.specificEnergy + MOON_MU_M3S2 / (MOON_RADIUS_M + el.periapsisAltM))),
  );
  const vCirc = Math.sqrt(MOON_MU_M3S2 / (MOON_RADIUS_M + el.periapsisAltM));
  const tau = burnDurationS(spec, s.propKg, Math.max(0, vPeri - vCirc));
  if (toPeri <= tau / 2 && aligned(s, retro, 4)) {
    return {
      controls: { targetPitchDeg: retro, bankDeg: 0, throttle: 1 },
      next: { ...g, phase: 'burn' },
      message: 'Lunar orbit insertion burn.',
    };
  }
  return {
    controls: { targetPitchDeg: retro, bankDeg: 0, throttle: 0 },
    next: { ...g, phase: 'coast', burnT: s.tS + toPeri, burnStartT: s.tS + toPeri - tau / 2 },
  };
}

function runTransEarth(
  g: LunarGuidance,
  s: FlightState,
  spec: ShipSpec,
  env: GravityEnv,
): LunarOutput {
  const inj = runInjection(g, s, spec, env, 'moon', () => planTei(s, env), 'trans-Earth injection');
  if (inj) return inj;
  if (g.phase === 'mcc-burn') return correctionBurn(g, s, spec, env);
  const metric = (c: CoastState, divisor: number) => {
    const r = predictReturn(c, env, { divisor, maxS: 7 * 86_400 });
    return r ? r.perigeeAltM - AEROCAPTURE_PERIGEE_M : null;
  };
  let next = g;
  if (s.tS - g.predictedAt > 1_800) {
    const r = predictReturn({ r: s.r, v: s.v, tS: s.tS }, env, {
      divisor: SCAN_DT_DIVISOR,
      maxS: 7 * 86_400,
    });
    next = { ...g, ret: r, predictedAt: s.tS };
  }
  // Near Earth: hand over to the aerocapture pass.
  const alt = localFrame(s.r).altitudeM;
  if (alt < 3_000_000 && dot(s.r, s.v) < 0 && g.phase === 'coast') {
    return {
      controls: hold(s),
      next: { ...startLunarProgram('aerocapture', g.goal), phase: 'coast' },
      message: 'Approaching Earth: aerocapture engaged.',
      chain: 'aerocapture',
    };
  }
  return coastWithCorrections(
    next,
    s,
    env,
    'earth',
    metric,
    next.ret?.perigeeT ?? null,
    pitchToward(unit(s.v), s, env),
  );
}

/**
 * Aerocapture: belly-first through the upper atmosphere, banking lift up or down so the ship
 * leaves the atmosphere into an orbit with the target apogee. Predicts the exit for a few
 * candidate banks every few seconds and flies the best one.
 */
function runAerocapture(g: LunarGuidance, s: FlightState, spec: ShipSpec): LunarOutput {
  const f = localFrame(s.r);
  const el = orbitalElements(s.r, s.v);
  const gamma = el.flightPathAngleDeg;
  const belly = gamma + BELLY_AOA_DEG;
  const dipped = g.dipped || f.altitudeM < 100_000;
  if (dipped && f.altitudeM > 130_000 && el.verticalSpeedMS > 0) {
    if (el.status === 'escape' || el.apoapsisAltM > 50_000_000)
      return {
        controls: hold(s),
        next: { ...g, phase: 'done' },
        message: 'Aerocapture too shallow: the ship skipped out.',
        chain: 'none',
      };
    return {
      controls: { targetPitchDeg: gamma, bankDeg: 0, throttle: 0 },
      next: { ...g, phase: 'done', dipped },
      message: `Aerocapture complete: ${Math.round(el.apoapsisAltM / 1000)} × ${Math.round(el.periapsisAltM / 1000)} km. Raising perigee.`,
      chain: 'circularize',
    };
  }
  // Too deep to climb out (or slowed into a normal re-entry): hand over to re-entry guidance.
  if (dipped && f.altitudeM < 60_000 && el.speedMS < 7_400) {
    return {
      controls: { targetPitchDeg: belly, bankDeg: 0, throttle: 0 },
      next: { ...g, phase: 'done', dipped },
      message: 'Captured into a direct re-entry. Re-entry guidance engaged.',
      chain: 'reentry',
    };
  }
  let next = { ...g, dipped };
  if (f.altitudeM < 140_000 && s.tS - g.predictedAt > 4) {
    // Apogee falls as bank rises (lift rotated downward keeps the ship deeper): bisect.
    const apoAt = (bank: number) => predictExitApogee(s, spec, bank) ?? -Infinity;
    let bestBank: number;
    if (apoAt(180) > AEROCAPTURE_APOGEE_M) bestBank = 180;
    else if (apoAt(0) < AEROCAPTURE_APOGEE_M) bestBank = 0;
    else {
      let lo = 0;
      let hi = 180;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (apoAt(mid) > AEROCAPTURE_APOGEE_M) lo = mid;
        else hi = mid;
      }
      bestBank = (lo + hi) / 2;
    }
    next = { ...next, bankDeg: bestBank, predictedAt: s.tS };
  }
  return { controls: { targetPitchDeg: belly, bankDeg: next.bankDeg, throttle: 0 }, next };
}

/** Exit apogee (altitude, m) if the ship held `bankDeg` through the pass; null if it stays in. */
export function predictExitApogee(s: FlightState, spec: ShipSpec, bankDeg: number): number | null {
  const ghostSpec: ShipSpec = { ...spec, shieldCoverage: 1, hasFlaps: true };
  let x: FlightState = { ...s, events: [], ref: undefined };
  const t0 = s.tS;
  let dipped = localFrame(x.r).altitudeM < 100_000;
  while (x.tS - t0 < 1_500) {
    const f = localFrame(x.r);
    const el = orbitalElements(x.r, x.v);
    if (f.altitudeM < 100_000) dipped = true;
    if (dipped && f.altitudeM > 125_000 && el.verticalSpeedMS > 0)
      return el.status === 'escape' ? 1e12 : el.apoapsisAltM;
    if (el.speedMS < 7_000) return null;
    x = stepFlight(
      { ...x, hull: 1, shield: 1 },
      ghostSpec,
      {
        targetPitchDeg: el.flightPathAngleDeg + BELLY_AOA_DEG,
        bankDeg,
        yawDeg: 0,
        throttle: 0,
        slewDegS: 90,
      },
      f.altitudeM > 130_000 ? 2 : 0.5,
    );
    if (x.phase !== 'flight') return null;
  }
  return null;
}

/** Program availability for the lunar programs. Pure. */
export function lunarProgramAvailability(
  program: LunarProgramId,
  s: FlightState,
  env: GravityEnv | null,
  goal: LunarGoal | null,
  inLunarOrbit: boolean,
): { ok: boolean; reason?: string } {
  if (!env || !goal) return { ok: false, reason: 'Only on Moon missions.' };
  if (s.phase !== 'flight') return { ok: false, reason: 'The ship is down.' };
  const noProp = s.propKg <= 0;
  const el = orbitalElements(s.r, s.v);
  switch (program) {
    case 'translunar':
      if (noProp) return { ok: false, reason: 'No propellant for the injection burn.' };
      if (s.ref === 'moon') return { ok: false, reason: 'Already at the Moon.' };
      if (el.status !== 'orbit' || el.apoapsisAltM > 2_000_000)
        return { ok: false, reason: 'Needs a stable, low parking orbit around Earth.' };
      return { ok: true };
    case 'lunar-orbit': {
      if (s.ref !== 'moon')
        return { ok: false, reason: "Only inside the Moon's sphere of influence." };
      if (inLunarOrbit) return { ok: false, reason: 'Already in lunar orbit.' };
      if (noProp) return { ok: false, reason: 'No propellant for the insertion burn.' };
      return { ok: true };
    }
    case 'trans-earth':
      if (s.ref !== 'moon' || !inLunarOrbit)
        return { ok: false, reason: 'Needs a lunar orbit to depart from.' };
      if (noProp) return { ok: false, reason: 'No propellant for the burn home.' };
      return { ok: true };
    case 'aerocapture': {
      if (s.ref === 'moon') return { ok: false, reason: 'Only on the way into Earth orbit.' };
      if (el.status !== 'escape' && el.apoapsisAltM < 2_000_000)
        return { ok: false, reason: 'Only for a fast return from the Moon.' };
      if (el.periapsisAltM > 120_000)
        return { ok: false, reason: 'Perigee is above the atmosphere.' };
      return { ok: true };
    }
  }
}

/** Whether the ship is in a closed orbit around the Moon. */
export function inLunarOrbit(s: FlightState, env: GravityEnv | null): boolean {
  if (!env || s.ref !== 'moon' || s.phase !== 'flight') return false;
  const rel = relPosition(s, 'moon', env);
  const vr = relVelocity(s, 'moon', env);
  const el = orbitalElements(rel, vr, MOON_BODY);
  return el.status === 'orbit' && el.apoapsisAltM < 20_000_000;
}

function formatIn(s: number): string {
  const m = Math.max(0, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Circular-orbit target for the post-aerocapture circularize program (re-exported for UI). */
export const POST_CAPTURE_PERIGEE_M = CIRCULAR_TARGET_PE_M;
