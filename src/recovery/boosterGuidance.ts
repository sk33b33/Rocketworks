import { G0_MS2 } from '../simulation/constants';
import {
  boosterMassKg,
  dragAccel,
  boosterThrustN,
  flightPathDeg,
  stepBooster,
  type BoosterControls,
  type BoosterState,
  type RecoveryTargetSpec,
} from './boosterModel';
import { CATCH_HEIGHT_M, type BoosterSpec } from './recoveryPlan';

/*
 * Assisted booster recovery: separation → flip → boostback (catch only) → coast → entry burn →
 * grid-fin glide → landing burn. The player can fly the landing burn manually for a bonus.
 * Guidance laws are simple and tuned for the game.
 */

export type GuidancePhase =
  'separation' | 'flip' | 'boostback' | 'coast' | 'entry-burn' | 'glide' | 'landing-burn' | 'done';

export const GUIDANCE_LABELS: Record<GuidancePhase, string> = {
  separation: 'Separation',
  flip: 'Flip maneuver',
  boostback: 'Boostback burn',
  coast: 'Coast',
  'entry-burn': 'Entry burn',
  glide: 'Grid-fin glide',
  'landing-burn': 'Landing burn',
  done: 'Down',
};

export const REC = {
  separationS: 4,
  /** Boostback nose: pointing back toward the launch site, a little above the horizon. */
  boostbackPitchDeg: 172,
  /** Aim slightly past the tower: the entry burn shortens the arc. */
  boostbackAimM: -2_500,
  entryStartAltM: 52_000,
  entryStartSpeedMS: 1_050,
  entryEndSpeedMS: 780,
  /** The entry burn never removes more than this (it protects the engines, not the range). */
  entryMaxDvMS: 450,
  entryEngines: 3,
  landingEngines: 3,
  /** The landing burn starts when waiting this much longer would leave too little room to stop. */
  ignitionLookaheadS: 1.5,
  /** Planned stopping point above the target (m), trimmed by the final approach. */
  ignitionMarginM: 300,
  legsAltM: 2_500,
  maxDivertTiltDeg: 70,
  /** Platform landing: retrograde braking until horizontal speed is below this. */
  retroUntilHorizMS: 20,
  /** Powered descent: aim this far above the target with this sink rate, using this share of thrust. */
  finalHeightM: 6,
  finalSinkMS: 1.5,
  guidanceThrustShare: 0.8,
  /** Share of the current drag the descent law relies on. */
  dragCredit: 0.3,
  /** Below this time-to-go, switch to the terminal settle law. */
  terminalS: 2.5,
  /** Manual landing is offered below this height above the target. */
  manualFromM: 9_000,
} as const;

export interface GuidanceState {
  readonly phase: GuidancePhase;
  /** Time the current phase started. */
  readonly phaseT: number;
  /** Last full impact prediction (x) and the vx it was made at, for linear extrapolation. */
  readonly predX: number | null;
  readonly predVx: number;
  readonly predT: number;
  /** d(impact x)/d(vx): sensitivity estimate (≈ remaining flight time). */
  readonly sens: number;
  /** Speed when the entry burn started. */
  readonly entrySpeed?: number;
  /** Planned end time of the powered descent. */
  readonly landingTf?: number;
}

export function initialGuidance(tS: number): GuidanceState {
  return { phase: 'separation', phaseT: tS, predX: null, predVx: 0, predT: -Infinity, sens: 200 };
}

/** Player inputs for a manual landing burn. */
export interface ManualLandingInput {
  /** 0..1 thrust command (0–⅓ runs one engine, above that three). */
  readonly throttle: number;
  /** Thrust tilt from vertical, degrees (positive pushes toward +x / downrange). */
  readonly tiltDeg: number;
}

const targetHeight = (t: RecoveryTargetSpec) => (t.mode === 'catch' ? CATCH_HEIGHT_M : 0);

/**
 * Where the booster comes down (x) if it coasts tail-first from here with neutral fins and the
 * nominal entry burn. Coarse steps for speed.
 */
export function predictImpactX(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  withEntryBurn = true,
): number {
  let st: BoosterState = { ...s, events: [] };
  let entry = false;
  let entryFrom: number | null = null;
  const ground = targetHeight(target);
  for (let i = 0; i < 4_000 && st.phase === 'flight'; i++) {
    const speed = Math.hypot(st.vx, st.vy);
    if (
      withEntryBurn &&
      entryFrom === null &&
      st.vy < 0 &&
      st.h < REC.entryStartAltM &&
      speed > REC.entryStartSpeedMS
    ) {
      entry = true;
      entryFrom = speed;
    }
    if (entry && entryBurnDone(speed, entryFrom ?? speed)) entry = false;
    const dt = st.h > 30_000 ? 1 : 0.5;
    st = stepBooster(
      { ...st, heatLoadJm2: 0 },
      spec,
      {
        targetPitchDeg: flightPathDeg(st) + 180,
        throttle: entry ? 1 : 0,
        engines: REC.entryEngines,
        finCmd: 0,
        deployFins: true,
        deployLegs: false,
      },
      { mode: 'platform', x: Number.NaN },
      dt,
    );
    if (st.h <= ground) break;
  }
  return st.x;
}

export interface GuidanceOutput {
  readonly controls: BoosterControls;
  readonly next: GuidanceState;
  readonly message?: string;
}

/** Runs assisted guidance for one step; `manual` overrides the landing burn when given. */
export function guideBooster(
  g: GuidanceState,
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  manual: ManualLandingInput | null,
): GuidanceOutput {
  const speed = Math.hypot(s.vx, s.vy);
  const tailFirst = flightPathDeg(s) + 180;
  const hold = (pitch: number, extra: Partial<BoosterControls> = {}): BoosterControls => ({
    targetPitchDeg: pitch,
    throttle: 0,
    engines: 0,
    finCmd: 0,
    deployFins: g.phase !== 'separation' && g.phase !== 'flip' && g.phase !== 'boostback',
    deployLegs: false,
    ...extra,
  });
  const to = (phase: GuidancePhase): GuidanceState => ({ ...g, phase, phaseT: s.tS });

  switch (g.phase) {
    case 'separation':
      if (s.tS - g.phaseT >= REC.separationS)
        return { controls: hold(s.pitchDeg), next: to('flip'), message: 'Flip maneuver.' };
      return { controls: hold(s.pitchDeg), next: g };
    case 'flip': {
      const want = target.mode === 'catch' ? REC.boostbackPitchDeg : tailFirst;
      if (Math.abs(((want - s.pitchDeg + 540) % 360) - 180) < 4) {
        return target.mode === 'catch'
          ? {
              controls: hold(want),
              next: to('boostback'),
              message: 'Boostback burn: heading home.',
            }
          : {
              controls: hold(want),
              next: to('coast'),
              message: 'Coasting downrange to the platform.',
            };
      }
      return { controls: hold(want), next: g };
    }
    case 'boostback': {
      let next = g;
      if (g.predX === null || s.tS - g.predT >= 1) {
        const px = predictImpactX(s, spec, target);
        // Sensitivity from two consecutive predictions (fallback: remaining flight time).
        const sens =
          g.predX !== null && Math.abs(s.vx - g.predVx) > 1
            ? Math.max(20, (px - g.predX) / (s.vx - g.predVx))
            : g.sens;
        next = { ...g, predX: px, predVx: s.vx, predT: s.tS, sens };
      }
      const est = (next.predX ?? Infinity) + next.sens * (s.vx - next.predVx);
      const aim = target.x + REC.boostbackAimM;
      if (est <= aim || s.propKg <= 0) {
        return {
          controls: hold(tailFirst),
          next: { ...next, phase: 'coast', phaseT: s.tS },
          message: 'Boostback complete. Grid fins out.',
        };
      }
      // Throttle down as the impact point closes on the aim point.
      const throttle = Math.max(0.4, Math.min(1, (est - aim) / 15_000));
      return {
        controls: hold(REC.boostbackPitchDeg, { throttle, engines: spec.stage.engineCount }),
        next,
      };
    }
    case 'coast':
      if (s.vy < 0 && s.h < REC.entryStartAltM && speed > REC.entryStartSpeedMS)
        return {
          controls: hold(tailFirst),
          next: { ...to('entry-burn'), entrySpeed: speed },
          message: 'Entry burn.',
        };
      if (s.vy < 0 && s.h < REC.entryStartAltM)
        return { controls: hold(tailFirst), next: to('glide'), message: 'Gliding on grid fins.' };
      return { controls: hold(tailFirst), next: g };
    case 'entry-burn':
      if (entryBurnDone(speed, g.entrySpeed ?? speed) || s.propKg <= 0)
        return {
          controls: hold(tailFirst),
          next: to('glide'),
          message: 'Entry burn complete. Gliding on grid fins.',
        };
      return { controls: hold(tailFirst, { throttle: 1, engines: REC.entryEngines }), next: g };
    case 'glide': {
      let next = g;
      if (s.tS - g.predT >= 0.5)
        next = { ...g, predX: predictImpactX(s, spec, target, false), predT: s.tS };
      // Fins steer the tower return; the platform is already stationed where this profile ends.
      const err = target.mode === 'catch' ? (next.predX ?? s.x) - target.x : 0;
      const finCmd = Math.max(-1, Math.min(1, -err / 1_200));
      const ign = landingIgnition(s, spec, target);
      if (ign)
        return {
          controls: hold(tailFirst, { finCmd }),
          next: { ...next, phase: 'landing-burn', phaseT: s.tS },
          message: 'Landing burn.',
        };
      return {
        controls: hold(tailFirst, {
          finCmd,
          deployLegs: target.mode === 'platform' && s.h < REC.legsAltM,
        }),
        next,
      };
    }
    case 'landing-burn': {
      if (manual) return { controls: manualControls(s, target, manual), next: g };
      if (target.mode === 'platform')
        return { controls: retroLandingControls(s, spec, target), next: g };
      // Tower catch: re-plan the precision descent every step.
      const tgo = chooseTimeToGo(s, spec, target, 1).tgo;
      return { controls: landingControls(s, spec, target, tgo), next: g };
    }
    default:
      return { controls: hold(s.pitchDeg), next: g };
  }
}

function entryBurnDone(speed: number, startSpeed: number): boolean {
  return speed <= Math.max(REC.entryEndSpeedMS, startSpeed - REC.entryMaxDvMS);
}

/**
 * Where a full-thrust retrograde burn started now would bring the booster to a stop (drag
 * included). `dry` = it would run out of propellant first; `h` = -Infinity if it hits the ground.
 */
export function stoppingAltitude(s: BoosterState, spec: BoosterSpec): { h: number; dry: boolean } {
  let st: BoosterState = { ...s, events: [], heatLoadJm2: 0 };
  for (let i = 0; i < 2_000 && st.phase === 'flight'; i++) {
    if (st.vy >= 0) return { h: st.h, dry: false };
    if (st.propKg <= 0) return { h: st.h, dry: true };
    if (st.h <= 0) return { h: -Infinity, dry: false };
    st = stepBooster(
      st,
      spec,
      {
        targetPitchDeg: flightPathDeg(st) + 180,
        throttle: 1,
        engines: REC.landingEngines,
        finCmd: 0,
        deployFins: true,
        deployLegs: false,
      },
      { mode: 'platform', x: Number.NaN },
      0.1,
    );
  }
  return { h: -Infinity, dry: false };
}

function landingIgnition(s: BoosterState, spec: BoosterSpec, target: RecoveryTargetSpec): boolean {
  if (s.vy >= 0 || s.h > 25_000) return false;
  // Coast a little further (tail-first): if no descent plan would still be flyable within the
  // thrust margin by then, light the engines now.
  let ahead: BoosterState = { ...s, events: [], heatLoadJm2: 0 };
  const steps = Math.round(REC.ignitionLookaheadS / 0.1);
  for (let i = 0; i < steps && ahead.phase === 'flight'; i++) {
    ahead = stepBooster(
      ahead,
      spec,
      {
        targetPitchDeg: flightPathDeg(ahead) + 180,
        throttle: 0,
        engines: 0,
        finCmd: 0,
        deployFins: true,
        deployLegs: false,
      },
      { mode: 'platform', x: Number.NaN },
      0.1,
    );
  }
  if (ahead.phase !== 'flight') return true;
  if (target.mode === 'catch') return !chooseTimeToGo(ahead, spec, target).feasible;
  // Platform: classic retro "suicide burn" timing (drag included); wait while drag still helps.
  const stop = stoppingAltitude(ahead, spec);
  if (stop.dry && s.h > 2_500) return false;
  return stop.h < targetHeight(target) + REC.ignitionMarginM;
}

/** Maximum thrust acceleration (m/s²) of the landing engines now (governor included). */
function landingAccelMax(s: BoosterState, spec: BoosterSpec): number {
  const mass = boosterMassKg(spec, s.propKg);
  const working = Math.max(1, Math.min(REC.landingEngines, spec.stage.engineCount - s.enginesOut));
  return Math.min(boosterThrustN(spec, working, s.h) / mass, 4 * G0_MS2);
}

/**
 * Powered-descent guidance: the minimum-effort acceleration that reaches the target point with
 * the target velocity in `tgo` seconds, plus gravity compensation. Returns the thrust
 * acceleration vector.
 */
export function descentThrust(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  tgo: number,
): [number, number] {
  const rx = target.x - s.x;
  const ry = targetHeight(target) + REC.finalHeightM - s.h;
  const vfx = 0;
  const vfy = -REC.finalSinkMS;
  const ax = (6 * rx) / (tgo * tgo) - (2 * (2 * s.vx + vfx)) / tgo;
  const ay = (6 * ry) / (tgo * tgo) - (2 * (2 * s.vy + vfy)) / tgo;
  // Drag (tail-first, current speed) helps: the engines only supply the rest.
  const [dx, dy] = dragAccel(
    s,
    spec,
    flightPathDeg(s) + 180,
    s.fins,
    boosterMassKg(spec, s.propKg),
  );
  // Only count on part of it: drag falls off as the booster slows.
  return [ax - dx * REC.dragCredit, ay + G0_MS2 - dy * REC.dragCredit];
}

/**
 * Longest flyable time-to-go: no longer than a constant-deceleration stop would take (longer
 * plans dip below the target and climb back), and within a share of the available thrust.
 * Null when even that plan needs more thrust: time to light the engines (or too late).
 */
export function chooseTimeToGo(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  share: number = REC.guidanceThrustShare,
): { tgo: number; feasible: boolean } {
  const aMax = landingAccelMax(s, spec) * share;
  const cone = Math.tan((REC.maxDivertTiltDeg * Math.PI) / 180);
  const hAbove = Math.max(0, s.h - targetHeight(target) - REC.finalHeightM);
  const sink = Math.max(REC.finalSinkMS, -s.vy);
  const longest = Math.min(120, Math.max(1, (2 * hAbove) / (sink + REC.finalSinkMS)));
  for (let tgo = longest; tgo >= 1; tgo -= 0.25) {
    const [ax, ay] = descentThrust(s, spec, target, tgo);
    if (ay > 0 && Math.hypot(ax, ay) <= aMax && Math.abs(ax) <= ay * cone)
      return { tgo, feasible: true };
  }
  // Nothing fits: fly the most relaxed plan at full thrust (best effort).
  return { tgo: longest, feasible: false };
}

function manualControls(
  s: BoosterState,
  target: RecoveryTargetSpec,
  manual: ManualLandingInput,
): BoosterControls {
  const t = Math.max(0, Math.min(1, manual.throttle));
  const one = t <= 1 / 3;
  return {
    finCmd: 0,
    deployFins: true,
    deployLegs: target.mode === 'platform' && s.h < REC.legsAltM,
    targetPitchDeg: 90 - Math.max(-20, Math.min(20, manual.tiltDeg)),
    throttle: t === 0 ? 0 : one ? t * 3 : t,
    engines: one ? 1 : REC.landingEngines,
  };
}

/** Thrust vector (acceleration, m/s²) → engine count, throttle and attitude. */
function thrustToControls(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  ax: number,
  ay: number,
): BoosterControls {
  const mass = boosterMassKg(spec, s.propKg);
  const perEngine = boosterThrustN(spec, 1, s.h);
  const thrust = Math.hypot(ax, ay) * mass;
  const engines = thrust < perEngine * 0.95 ? 1 : REC.landingEngines;
  return {
    finCmd: 0,
    deployFins: true,
    deployLegs: target.mode === 'platform',
    targetPitchDeg: (Math.atan2(ay, ax) * 180) / Math.PI,
    throttle: Math.min(1, thrust / (perEngine * engines)),
    engines,
  };
}

/**
 * Platform landing: full-thrust retrograde braking until the horizontal speed is gone, then a
 * vertical suicide burn with a small divert onto the deck.
 */
function retroLandingControls(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
): BoosterControls {
  const hAbove = s.h - targetHeight(target);
  if (Math.abs(s.vx) > REC.retroUntilHorizMS && hAbove > 80) {
    return {
      finCmd: 0,
      deployFins: true,
      deployLegs: s.h < REC.legsAltM,
      targetPitchDeg: flightPathDeg(s) + 180,
      throttle: 1,
      engines: REC.landingEngines,
    };
  }
  const need = s.vy < 0 ? (s.vy * s.vy) / (2 * Math.max(1, hAbove - REC.finalHeightM)) : 0;
  let ay = G0_MS2 + need * 1.05;
  if (hAbove < 40) ay = G0_MS2 + 2 * (-(REC.finalSinkMS + Math.max(0, hAbove) * 0.06) - s.vy);
  const err = Number.isFinite(target.x) ? s.x - target.x : 0;
  const tgo = Math.max(2, Math.max(0, hAbove) / Math.max(2, -s.vy));
  // Near the deck, stopping the drift matters more than the last few metres of position.
  const vxCap = Math.min(15, Math.max(0, hAbove) * 0.08);
  const vxWant = Math.max(-vxCap, Math.min(vxCap, -err / tgo));
  let ax = 3 * (vxWant - s.vx);
  ay = Math.max(0, ay);
  const maxTilt = Math.tan(((hAbove < 15 ? 6 : 25) * Math.PI) / 180);
  if (Math.abs(ax) > ay * maxTilt) ax = Math.sign(ax) * ay * maxTilt;
  return thrustToControls(s, spec, target, ax, ay);
}

function landingControls(
  s: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  tgo: number,
): BoosterControls {
  const hAbove = s.h - targetHeight(target);
  let ax: number;
  let ay: number;
  if (tgo > REC.terminalS) {
    [ax, ay] = descentThrust(s, spec, target, tgo);
  } else {
    // Terminal: settle at a slow sink rate straight down, nulling any drift.
    const vyTarget = -(REC.finalSinkMS + Math.max(0, hAbove) * 0.06);
    ay = G0_MS2 + 2 * (vyTarget - s.vy);
    ax = 1.5 * (-(s.x - target.x) * 0.3 - s.vx);
  }
  // Keep the thrust within a cone around vertical (the booster can't fly sideways).
  const tiltLimit = hAbove < 25 ? 5 : hAbove < 300 ? 20 : REC.maxDivertTiltDeg;
  const maxTilt = (tiltLimit * Math.PI) / 180;
  ay = Math.max(0, ay);
  if (Math.abs(ax) > ay * Math.tan(maxTilt)) ax = Math.sign(ax) * ay * Math.tan(maxTilt);
  return thrustToControls(s, spec, target, ax, ay);
}

/**
 * Runs the assisted recovery to the end. With `target.x` NaN (platform planning) the booster
 * flies its natural profile; the result's x is where the platform should wait.
 */
export function simulateAssistedRecovery(
  start: BoosterState,
  spec: BoosterSpec,
  target: RecoveryTargetSpec,
  dt = 0.05,
): BoosterState {
  let s = start;
  let g = initialGuidance(s.tS);
  for (let i = 0; i < 60_000 && s.phase === 'flight'; i++) {
    const out = guideBooster(g, s, spec, target, null);
    g = out.next;
    s = stepBooster(s, spec, out.controls, target, dt);
  }
  return s;
}

/** Where to station the platform: the natural end point of the assisted profile (rounded). */
export function planPlatformX(start: BoosterState, spec: BoosterSpec): number {
  const end = simulateAssistedRecovery(start, spec, { mode: 'platform', x: Number.NaN });
  return Math.round(end.x / 10) * 10;
}
