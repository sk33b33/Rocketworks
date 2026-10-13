import { heatFlux } from '../flight/flightModel';
import { effectiveGravity, type StagingSnapshot } from '../simulation/ascent/ascentModel';
import { airDensity, G0_MS2, pressureRatio } from '../simulation/constants';
import {
  BOOSTER_TOUCHDOWN,
  CATCH_HEIGHT_M,
  CATCH_WINDOW,
  PLATFORM_HALF_DECK_M,
  type BoosterSpec,
} from './recoveryPlan';

/*
 * Booster return model in the ascent's 2D frame (x = downrange from the pad along the surface,
 * h = altitude of the booster's base). Gravity includes the same curvature relief as the ascent.
 * Attitude is the nose direction above the +x horizon (90 = upright; engines thrust along it).
 * Gameplay model, not engineering data.
 */

export type BoosterPhase = 'flight' | 'caught' | 'landed' | 'crashed' | 'splashed' | 'lost';
export type RecoveryMode = 'catch' | 'platform';

export interface BoosterEvent {
  readonly tS: number;
  readonly kind: 'info' | 'warn' | 'fail' | 'success';
  readonly text: string;
}

export interface BoosterState {
  readonly tS: number;
  readonly x: number;
  readonly h: number;
  readonly vx: number;
  readonly vy: number;
  readonly propKg: number;
  readonly pitchDeg: number;
  readonly throttle: number;
  readonly enginesLit: number;
  readonly enginesOut: number;
  /** 0..1 deployment of grid fins and landing legs (animated). */
  readonly fins: number;
  readonly legs: number;
  readonly heatLoadJm2: number;
  readonly peakHeatWm2: number;
  readonly peakQPa: number;
  readonly phase: BoosterPhase;
  readonly events: readonly BoosterEvent[];
  /** Metrics at the moment of capture or touchdown (set once the booster is down). */
  readonly contact?: ContactMetrics;
}

export interface ContactMetrics {
  readonly missM: number;
  readonly vertMS: number;
  readonly horizMS: number;
  readonly tiltDeg: number;
}

export interface BoosterControls {
  readonly targetPitchDeg: number;
  readonly throttle: number;
  /** Engines requested (the model clamps to the working count). */
  readonly engines: number;
  /** Grid-fin steering command -1..1 (positive pushes toward +x). */
  readonly finCmd: number;
  readonly deployFins: boolean;
  readonly deployLegs: boolean;
}

export const BOOSTER = {
  /** Attitude slew (deg/s): cold-gas thrusters in vacuum, grid fins in the air. */
  slewVacuum: 12,
  slewAero: 25,
  /** Tail-first drag coefficient with fins deployed / stowed. */
  cdFinsOut: 1.1,
  cdFinsIn: 0.8,
  /** Side-on drag coefficient. */
  cdSide: 1.2,
  /** Grid-fin lateral authority as a share of dynamic-pressure force on the end area. */
  finAuthority: 0.35,
  maxAccelG: 4,
  minThrottle: 0.4,
  /** Engine-bay heat load (J/m²) the booster tolerates before it is lost (game value). */
  heatLimitJm2: 9e6,
  deploySeconds: 3,
} as const;

export function initialBoosterState(s: StagingSnapshot, spec: BoosterSpec): BoosterState {
  return {
    tS: s.tS,
    x: s.downrangeM,
    h: s.altitudeM,
    vx: s.vHorizMS,
    vy: s.vVertMS,
    propKg: s.boosterPropKg,
    pitchDeg: (Math.atan2(s.vVertMS, s.vHorizMS) * 180) / Math.PI,
    throttle: 0,
    enginesLit: 0,
    enginesOut: Math.min(s.boosterEnginesOut, spec.stage.engineCount),
    fins: 0,
    legs: 0,
    heatLoadJm2: 0,
    peakHeatWm2: 0,
    peakQPa: 0,
    phase: 'flight',
    events: [],
  };
}

export const wrap180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
export const flightPathDeg = (s: Pick<BoosterState, 'vx' | 'vy'>) =>
  (Math.atan2(s.vy, s.vx) * 180) / Math.PI;
/** Tilt of the nose from vertical (deg). */
export const tiltDeg = (pitchDeg: number) => Math.abs(wrap180(90 - pitchDeg));

export function boosterMassKg(spec: BoosterSpec, propKg: number): number {
  return spec.stage.dryMassKg + propKg;
}

/** Maximum thrust (N) of `engines` working engines at an altitude. */
export function boosterThrustN(spec: BoosterSpec, engines: number, h: number): number {
  const vacFrac = 1 - pressureRatio(Math.max(0, h));
  const per =
    spec.stage.thrustSlPerEngineN +
    (spec.stage.thrustVacPerEngineN - spec.stage.thrustSlPerEngineN) * vacFrac;
  return per * engines;
}

export interface RecoveryTargetSpec {
  readonly mode: RecoveryMode;
  /** Target downrange position (0 = launch tower). */
  readonly x: number;
}

/** Advances the booster by one fixed step. Pure. */
export function stepBooster(
  s: BoosterState,
  spec: BoosterSpec,
  c: BoosterControls,
  target: RecoveryTargetSpec,
  dt: number,
): BoosterState {
  if (s.phase !== 'flight') return s;
  const events: BoosterEvent[] = [];
  const t = s.tS + dt;
  const rho = airDensity(Math.max(0, s.h));
  const speed = Math.hypot(s.vx, s.vy);
  const hasFins = spec.hardware.gridFins >= 4;
  const hasLegs = spec.hardware.boosterLegs >= 4;

  // Deployments.
  const rate = dt / BOOSTER.deploySeconds;
  const fins = hasFins && c.deployFins ? Math.min(1, s.fins + rate) : s.fins;
  const legs = hasLegs && c.deployLegs ? Math.min(1, s.legs + rate) : s.legs;
  if (s.fins < 1 && fins >= 1) events.push({ tS: t, kind: 'info', text: 'Grid fins deployed.' });
  if (s.legs < 1 && legs >= 1) events.push({ tS: t, kind: 'info', text: 'Landing legs deployed.' });

  // Attitude slew.
  const slew = (rho > 1e-4 && fins > 0.5 ? BOOSTER.slewAero : BOOSTER.slewVacuum) * dt;
  const delta = wrap180(c.targetPitchDeg - s.pitchDeg);
  const pitchDeg = wrap180(s.pitchDeg + Math.max(-slew, Math.min(slew, delta)));

  // Engines (with an acceleration governor and a one-engine minimum-throttle floor).
  const mass = boosterMassKg(spec, s.propKg);
  const working = Math.max(0, spec.stage.engineCount - s.enginesOut);
  const lit =
    s.propKg > 0 && c.throttle > 0 ? Math.max(1, Math.min(working, Math.round(c.engines))) : 0;
  let throttle = 0;
  let thrustN = 0;
  if (lit > 0) {
    const full = boosterThrustN(spec, lit, s.h);
    throttle = Math.max(
      BOOSTER.minThrottle,
      Math.min(1, c.throttle, (BOOSTER.maxAccelG * G0_MS2 * mass) / full),
    );
    thrustN = full * throttle;
  }
  const vacFrac = 1 - pressureRatio(Math.max(0, s.h));
  const isp = spec.stage.ispSlS + (spec.stage.ispVacS - spec.stage.ispSlS) * vacFrac;
  const burned = Math.min(s.propKg, thrustN > 0 && isp > 0 ? (thrustN / (isp * G0_MS2)) * dt : 0);
  const p = (pitchDeg * Math.PI) / 180;
  let ax = (thrustN / mass) * Math.cos(p);
  let ay = (thrustN / mass) * Math.sin(p);

  // Aerodynamics: tail-first drag blends to side-on drag with the angle off the flow.
  const q = speed > 1 && rho > 1e-9 ? 0.5 * rho * speed * speed : 0;
  if (q > 0) {
    const [dx, dy] = dragAccel(s, spec, pitchDeg, fins, mass);
    ax += dx;
    ay += dy;
    const endArea = Math.PI * spec.radiusM * spec.radiusM;
    // Grid fins: lateral force perpendicular to the velocity, steering toward ±x.
    if (fins > 0.5) {
      const lat =
        (BOOSTER.finAuthority * q * endArea * fins * Math.max(-1, Math.min(1, c.finCmd))) / mass;
      let nx = -s.vy / speed;
      let ny = s.vx / speed;
      if (nx < 0) {
        nx = -nx;
        ny = -ny;
      }
      ax += lat * nx;
      ay += lat * ny;
    }
  }
  ay -= effectiveGravity(Math.max(0, s.h), s.vx);

  const vx = s.vx + ax * dt;
  const vy = s.vy + ay * dt;
  const x = s.x + vx * dt;
  const h = s.h + vy * dt;

  // Engine-bay heating on the way down (the booster has no heat shield).
  const flux = heatFlux(rho, speed);
  const heatLoadJm2 = s.heatLoadJm2 + flux * dt;
  let next: BoosterState = {
    ...s,
    tS: t,
    x,
    h,
    vx,
    vy,
    propKg: s.propKg - burned,
    pitchDeg,
    throttle: thrustN > 0 ? throttle : 0,
    enginesLit: thrustN > 0 ? lit : 0,
    fins,
    legs,
    heatLoadJm2,
    peakHeatWm2: Math.max(s.peakHeatWm2, flux),
    peakQPa: Math.max(s.peakQPa, q),
  };
  if (s.propKg > 0 && next.propKg <= 0)
    events.push({ tS: t, kind: 'warn', text: 'Booster propellant depleted.' });

  if (heatLoadJm2 >= BOOSTER.heatLimitJm2) {
    events.push({
      tS: t,
      kind: 'fail',
      text: 'Booster engine bay overheated during re-entry: vehicle lost.',
    });
    next = { ...next, phase: 'lost', throttle: 0, enginesLit: 0 };
  } else if (target.mode === 'catch' && s.h > CATCH_HEIGHT_M && h <= CATCH_HEIGHT_M) {
    next = catchAttempt(next, target, events, t);
  } else if (h <= 0) {
    next = surfaceContact(next, target, events, t);
  }
  return events.length ? { ...next, events: [...s.events, ...events] } : next;
}

/** Drag acceleration vector (m/s²) for an attitude and fin deployment. */
export function dragAccel(
  s: Pick<BoosterState, 'h' | 'vx' | 'vy'>,
  spec: BoosterSpec,
  pitchDeg: number,
  fins: number,
  mass: number,
): [number, number] {
  const speed = Math.hypot(s.vx, s.vy);
  const rho = airDensity(Math.max(0, s.h));
  if (speed <= 1 || rho <= 1e-9) return [0, 0];
  const q = 0.5 * rho * speed * speed;
  const flowDeg = (Math.atan2(-s.vy, -s.vx) * 180) / Math.PI; // direction the air comes from
  const off = (wrap180(pitchDeg - flowDeg) * Math.PI) / 180; // 0 = nose into the wind
  const endArea = Math.PI * spec.radiusM * spec.radiusM;
  const sideArea = spec.lengthM * spec.radiusM * 2;
  const cdEnd = BOOSTER.cdFinsIn + (BOOSTER.cdFinsOut - BOOSTER.cdFinsIn) * fins;
  const cdA = cdEnd * endArea * Math.cos(off) ** 2 + BOOSTER.cdSide * sideArea * Math.sin(off) ** 2;
  const drag = (q * cdA) / mass;
  return [(-drag * s.vx) / speed, (-drag * s.vy) / speed];
}

/** Touchdown / capture metrics. */
export function contactMetrics(s: BoosterState, targetX: number): ContactMetrics {
  return {
    missM: s.x - targetX,
    vertMS: -s.vy,
    horizMS: Math.abs(s.vx),
    tiltDeg: tiltDeg(s.pitchDeg),
  };
}

function catchAttempt(
  s: BoosterState,
  target: RecoveryTargetSpec,
  events: BoosterEvent[],
  t: number,
): BoosterState {
  const m = contactMetrics(s, target.x);
  const ok =
    Math.abs(m.missM) <= CATCH_WINDOW.missM &&
    m.vertMS <= CATCH_WINDOW.vertMS &&
    m.horizMS <= CATCH_WINDOW.horizMS &&
    m.tiltDeg <= CATCH_WINDOW.tiltDeg;
  if (!ok) {
    const why =
      Math.abs(m.missM) > CATCH_WINDOW.missM
        ? `${Math.abs(m.missM).toFixed(0)} m off the tower`
        : m.vertMS > CATCH_WINDOW.vertMS
          ? `descending at ${m.vertMS.toFixed(1)} m/s`
          : m.horizMS > CATCH_WINDOW.horizMS
            ? `drifting at ${m.horizMS.toFixed(1)} m/s`
            : `tilted ${m.tiltDeg.toFixed(0)}°`;
    events.push({ tS: t, kind: 'warn', text: `Catch arms missed: booster ${why}.` });
    return s;
  }
  events.push({
    tS: t,
    kind: 'success',
    text: `Caught by the tower arms (${Math.abs(m.missM).toFixed(1)} m off centre, ${m.vertMS.toFixed(1)} m/s).`,
  });
  return {
    ...s,
    h: CATCH_HEIGHT_M,
    vx: 0,
    vy: 0,
    throttle: 0,
    enginesLit: 0,
    phase: 'caught',
    contact: m,
  };
}

function surfaceContact(
  s: BoosterState,
  target: RecoveryTargetSpec,
  events: BoosterEvent[],
  t: number,
): BoosterState {
  const m = contactMetrics(s, target.x);
  const onDeck = target.mode === 'platform' && Math.abs(m.missM) <= PLATFORM_HALF_DECK_M;
  // The launch site and its surroundings are land; downrange is open ocean.
  const onLand = Math.abs(s.x) < 5_000;
  const gentle =
    m.vertMS <= BOOSTER_TOUCHDOWN.vertMS &&
    m.horizMS <= BOOSTER_TOUCHDOWN.horizMS &&
    m.tiltDeg <= BOOSTER_TOUCHDOWN.tiltDeg &&
    s.legs >= 1;
  let phase: BoosterPhase;
  let text: string;
  if (onDeck && gentle) {
    phase = 'landed';
    text = `Booster landed on the platform (${Math.abs(m.missM).toFixed(1)} m off centre, ${m.vertMS.toFixed(1)} m/s).`;
  } else if (onDeck || onLand) {
    phase = 'crashed';
    text =
      s.legs < 1 && m.vertMS <= BOOSTER_TOUCHDOWN.vertMS
        ? 'Booster touched down without landing legs and toppled.'
        : `Booster impact at ${m.vertMS.toFixed(0)} m/s.`;
  } else {
    phase = 'splashed';
    text = `Booster came down in the ocean ${(Math.abs(m.missM) / 1000).toFixed(1)} km from the target.`;
  }
  events.push({ tS: t, kind: phase === 'landed' ? 'success' : 'fail', text });
  return { ...s, h: 0, vx: 0, vy: 0, throttle: 0, enginesLit: 0, phase, contact: m };
}
