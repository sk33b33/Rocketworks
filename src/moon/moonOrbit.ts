import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';
import { wrapAngle, type Vec2 } from '../flight/orbitMath';

/*
 * The Moon in the game's single orbital plane: a circular orbit around Earth, moving eastward
 * (clockwise) like everything else, and rotating synchronously (the same side always faces Earth).
 * Gravity is the restricted three-body model in an Earth-centred frame: Earth, the Moon's direct
 * pull, and the indirect term (the Moon also accelerates Earth). Simplified gameplay model.
 */

export const MOON_MU_M3S2 = 4.9048695e12;
export const MOON_RADIUS_M = 1_737_400;
export const MOON_DISTANCE_M = 384_400_000;
/** Mean motion consistent with the two-body Earth–Moon orbit (rad/s). */
export const MOON_N = Math.sqrt((EARTH_MU_M3S2 + MOON_MU_M3S2) / MOON_DISTANCE_M ** 3);
/** Sphere of influence: inside it, attitude and telemetry refer to the Moon. */
export const MOON_SOI_M = MOON_DISTANCE_M * (MOON_MU_M3S2 / EARTH_MU_M3S2) ** 0.4;
/** Speed of the Moon's surface due to its (synchronous) rotation, at the equator. */
export const MOON_SURFACE_SPEED_MS = MOON_N * MOON_RADIUS_M;

export interface MoonEphemeris {
  /** Ground angle of the Moon (atan2(x, y) convention) at t0. */
  readonly angle0: number;
  readonly t0: number;
}

/** Default ephemeris (any phase works: the departure window opens within one parking orbit). */
export const DEFAULT_MOON_EPHEMERIS: MoonEphemeris = { angle0: 2.2, t0: 0 };

export interface MoonState {
  readonly angle: number;
  readonly r: Vec2;
  readonly v: Vec2;
}

export function moonState(e: MoonEphemeris, tS: number): MoonState {
  const angle = wrapAngle(e.angle0 + MOON_N * (tS - e.t0));
  const up: Vec2 = [Math.sin(angle), Math.cos(angle)];
  const speed = MOON_N * MOON_DISTANCE_M;
  return {
    angle,
    r: [up[0] * MOON_DISTANCE_M, up[1] * MOON_DISTANCE_M],
    v: [up[1] * speed, -up[0] * speed],
  };
}

export interface GravityEnv {
  readonly moon: MoonEphemeris;
  /** Terrain slope (deg) at a selenographic angle, for touchdowns. */
  readonly slopeAt?: (selenoAngle: number) => number;
}

/** Gravitational acceleration at `r` (Earth-centred frame). */
export function gravityAccel(r: Vec2, tS: number, env?: GravityEnv | null): Vec2 {
  const rE = Math.hypot(r[0], r[1]);
  const kE = -EARTH_MU_M3S2 / (rE * rE * rE);
  if (!env) return [kE * r[0], kE * r[1]];
  const m = moonState(env.moon, tS);
  const d: Vec2 = [r[0] - m.r[0], r[1] - m.r[1]];
  const dM = Math.hypot(d[0], d[1]);
  const kM = -MOON_MU_M3S2 / (dM * dM * dM);
  const kI = -MOON_MU_M3S2 / MOON_DISTANCE_M ** 3;
  return [kE * r[0] + kM * d[0] + kI * m.r[0], kE * r[1] + kM * d[1] + kI * m.r[1]];
}

export type ReferenceBody = 'earth' | 'moon';

/** Local frame relative to the reference body (the Moon inside its sphere of influence). */
export interface BodyFrame {
  readonly body: ReferenceBody;
  readonly mu: number;
  readonly radiusM: number;
  /** Position and velocity relative to the body's centre (velocity in the inertial sense). */
  readonly r: Vec2;
  readonly v: Vec2;
  readonly up: Vec2;
  readonly east: Vec2;
  readonly altitudeM: number;
  /** Angle of `up` (atan2(x, y) convention). */
  readonly upAngle: number;
}

export function referenceBody(r: Vec2, tS: number, env?: GravityEnv | null): ReferenceBody {
  if (!env) return 'earth';
  const m = moonState(env.moon, tS);
  return Math.hypot(r[0] - m.r[0], r[1] - m.r[1]) < MOON_SOI_M ? 'moon' : 'earth';
}

export function bodyFrame(
  body: ReferenceBody,
  r: Vec2,
  v: Vec2,
  tS: number,
  env?: GravityEnv | null,
): BodyFrame {
  let rr = r;
  let vv = v;
  if (body === 'moon' && env) {
    const m = moonState(env.moon, tS);
    rr = [r[0] - m.r[0], r[1] - m.r[1]];
    vv = [v[0] - m.v[0], v[1] - m.v[1]];
  }
  const d = Math.hypot(rr[0], rr[1]);
  const up: Vec2 = [rr[0] / d, rr[1] / d];
  const radiusM = body === 'moon' ? MOON_RADIUS_M : EARTH_RADIUS_M;
  return {
    body,
    mu: body === 'moon' ? MOON_MU_M3S2 : EARTH_MU_M3S2,
    radiusM,
    r: rr,
    v: vv,
    up,
    east: [up[1], -up[0]],
    altitudeM: d - radiusM,
    upAngle: Math.atan2(up[0], up[1]),
  };
}

/** Frame of the body the ship currently refers to. */
export function shipFrame(
  s: { readonly r: Vec2; readonly v: Vec2; readonly tS: number },
  env?: GravityEnv | null,
): BodyFrame {
  return bodyFrame(referenceBody(s.r, s.tS, env), s.r, s.v, s.tS, env);
}

/**
 * Selenographic angle of a point (radians): 0 is the sub-Earth point (the middle of the near
 * side), positive eastward (clockwise, the direction of the Moon's motion and rotation).
 */
export function selenoAngle(r: Vec2, tS: number, e: MoonEphemeris): number {
  const m = moonState(e, tS);
  const rel: Vec2 = [r[0] - m.r[0], r[1] - m.r[1]];
  const toEarth = Math.atan2(-m.r[0], -m.r[1]);
  return wrapAngle(Math.atan2(rel[0], rel[1]) - toEarth);
}

/** Inertial position and velocity of a surface point (it turns with the Moon). */
export function surfaceState(
  seleno: number,
  tS: number,
  e: MoonEphemeris,
  altitudeM = 0,
): { r: Vec2; v: Vec2 } {
  const m = moonState(e, tS);
  const a = Math.atan2(-m.r[0], -m.r[1]) + seleno;
  const up: Vec2 = [Math.sin(a), Math.cos(a)];
  const d = MOON_RADIUS_M + altitudeM;
  const spin = MOON_N * d;
  return {
    r: [m.r[0] + up[0] * d, m.r[1] + up[1] * d],
    v: [m.v[0] + up[1] * spin, m.v[1] - up[0] * spin],
  };
}

/** Pitch (deg) conversion when the attitude reference switches body: keeps the nose fixed. */
export function convertPitch(pitchDeg: number, fromUpAngle: number, toUpAngle: number): number {
  // Nose angle φ = α + 90° − pitch, so pitch' = pitch + (α' − α).
  return pitchDeg + ((toUpAngle - fromUpAngle) * 180) / Math.PI;
}
