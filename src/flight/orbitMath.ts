import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../simulation/constants';

/*
 * Planar two-body orbit mathematics in an Earth-centred inertial frame (x, y in metres). The ship
 * moves clockwise (eastward); "prograde horizontal" is u_t = (u_r.y, -u_r.x). Simplified model:
 * no Earth rotation, no oblateness, single orbital plane.
 */

export type Vec2 = readonly [number, number];

export const len = (v: Vec2) => Math.hypot(v[0], v[1]);
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
/** z-component of the 2D cross product. */
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

export interface LocalFrame {
  /** Unit radial (up). */
  readonly up: Vec2;
  /** Unit horizontal in the direction of motion (eastward, clockwise). */
  readonly east: Vec2;
  readonly altitudeM: number;
  /** Ground angle from the launch site (radians, increasing eastward). */
  readonly groundAngle: number;
}

export function localFrame(r: Vec2): LocalFrame {
  const d = len(r);
  const up: Vec2 = [r[0] / d, r[1] / d];
  return {
    up,
    east: [up[1], -up[0]],
    altitudeM: d - EARTH_RADIUS_M,
    groundAngle: Math.atan2(r[0], r[1]),
  };
}

/** Position on (or above) the surface at a ground angle. */
export function surfacePoint(groundAngle: number, altitudeM = 0): Vec2 {
  const d = EARTH_RADIUS_M + altitudeM;
  return [d * Math.sin(groundAngle), d * Math.cos(groundAngle)];
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

export interface OrbitalElements {
  readonly semiMajorAxisM: number;
  readonly eccentricity: number;
  /** Altitudes above the surface; apoapsis is Infinity for escape trajectories. */
  readonly apoapsisAltM: number;
  readonly periapsisAltM: number;
  readonly periodS: number;
  /** Argument of periapsis measured as a ground angle (atan2(x, y) convention). */
  readonly periapsisAngle: number;
  readonly specificEnergy: number;
  readonly flightPathAngleDeg: number;
  readonly speedMS: number;
  readonly horizontalSpeedMS: number;
  readonly verticalSpeedMS: number;
  readonly status: 'suborbital' | 'orbit' | 'escape';
}

/** Minimum periapsis for a "stable" orbit in this game (gameplay value). */
export const STABLE_PERIAPSIS_M = 120_000;

/** A central body for orbital elements (Earth by default; the Moon in lunar flight). */
export interface OrbitBody {
  readonly mu: number;
  readonly radiusM: number;
  /** Periapsis altitude above which an orbit counts as "stable" (gameplay value). */
  readonly stablePeriapsisM: number;
}

export const EARTH_BODY: OrbitBody = {
  mu: EARTH_MU_M3S2,
  radiusM: EARTH_RADIUS_M,
  stablePeriapsisM: STABLE_PERIAPSIS_M,
};

/** Elements of the conic about `body` (r and v relative to the body's centre). */
export function orbitalElements(r: Vec2, v: Vec2, body: OrbitBody = EARTH_BODY): OrbitalElements {
  const mu = body.mu;
  const rMag = len(r);
  const vMag = len(v);
  const up: Vec2 = [r[0] / rMag, r[1] / rMag];
  const east: Vec2 = [up[1], -up[0]];
  const vH = dot(v, east);
  const vV = dot(v, up);
  const energy = (vMag * vMag) / 2 - mu / rMag;
  const h = cross(r, v); // negative for clockwise motion
  // Eccentricity vector: ((v² - μ/r) r - (r·v) v) / μ
  const k = vMag * vMag - mu / rMag;
  const rv = dot(r, v);
  const ev: Vec2 = [(k * r[0] - rv * v[0]) / mu, (k * r[1] - rv * v[1]) / mu];
  const e = len(ev);
  const p = (h * h) / mu;
  const rp = p / (1 + e);
  const escape = energy >= 0;
  const a = escape ? Infinity : -mu / (2 * energy);
  const ra = escape ? Infinity : p / (1 - e);
  const periapsisAltM = rp - body.radiusM;
  return {
    semiMajorAxisM: a,
    eccentricity: e,
    apoapsisAltM: ra - body.radiusM,
    periapsisAltM,
    periodS: escape ? Infinity : 2 * Math.PI * Math.sqrt((a * a * a) / mu),
    periapsisAngle: e > 1e-9 ? Math.atan2(ev[0], ev[1]) : Math.atan2(r[0], r[1]),
    specificEnergy: energy,
    flightPathAngleDeg: (Math.atan2(vV, vH) * 180) / Math.PI,
    speedMS: vMag,
    horizontalSpeedMS: vH,
    verticalSpeedMS: vV,
    status: escape ? 'escape' : periapsisAltM >= body.stablePeriapsisM ? 'orbit' : 'suborbital',
  };
}

/**
 * Points along the (clockwise) conic, as ground angle + radius. For suborbital paths the curve
 * is cut where it meets the surface. Used by both the 3D map and the 2D inset.
 */
export function orbitPath(
  el: OrbitalElements,
  fromAngle: number,
  samples = 128,
  surfaceRadiusM = EARTH_RADIUS_M,
): { angle: number; radiusM: number }[] {
  if (el.status === 'escape' || !Number.isFinite(el.semiMajorAxisM)) return [];
  const e = el.eccentricity;
  const p = el.semiMajorAxisM * (1 - e * e);
  const out: { angle: number; radiusM: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const angle = fromAngle + (2 * Math.PI * i) / samples;
    // Clockwise motion: true anomaly increases with ground angle measured from periapsis.
    const nu = angle - el.periapsisAngle;
    const radiusM = p / (1 + e * Math.cos(nu));
    if (i > 0 && radiusM < surfaceRadiusM) break;
    out.push({ angle, radiusM });
  }
  return out;
}

/** Time from now until the vehicle next reaches apoapsis / periapsis (bounded orbits). */
export function timeToApsides(
  r: Vec2,
  v: Vec2,
  el: OrbitalElements,
): { toApoS: number; toPeriS: number } {
  if (el.status === 'escape' || el.eccentricity < 1e-6) return { toApoS: 0, toPeriS: 0 };
  const e = el.eccentricity;
  const nu = wrapAngle(Math.atan2(r[0], r[1]) - el.periapsisAngle);
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const M = E - e * Math.sin(E);
  const n = (2 * Math.PI) / el.periodS;
  const tSincePeri = (((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / n;
  const toPeriS = el.periodS - tSincePeri;
  const toApoS = (el.periodS / 2 - tSincePeri + el.periodS) % el.periodS;
  void v;
  return { toApoS, toPeriS: toPeriS % el.periodS };
}

/** Speed needed at radius r on an ellipse with the given radii (vis-viva). */
export function visVivaSpeed(rM: number, raM: number, rpM: number, mu = EARTH_MU_M3S2): number {
  return Math.sqrt(mu * (2 / rM - 2 / (raM + rpM)));
}
