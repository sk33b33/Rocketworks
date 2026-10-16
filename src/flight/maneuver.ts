import { EARTH_MU_M3S2 } from '../simulation/constants';
import {
  add,
  dot,
  len,
  localFrame,
  orbitalElements,
  scale,
  timeToApsides,
  type OrbitalElements,
  type Vec2,
} from './orbitMath';

/*
 * Manoeuvre planning around Earth: a node is a burn at a chosen time with prograde and radial
 * components. Two-body Kepler propagation (the same planar model the flight uses in vacuum) gives
 * the ship's state at the node, and adding the Δv gives the orbit after the burn, so the map can
 * show it before anything is flown. Pure and deterministic. The burn itself is flown by the
 * autopilot's execute-node program, which delivers the Δv over a finite time (split around the
 * node), so the result differs slightly from this impulsive prediction.
 */

export interface ManeuverNode {
  /** Mission time of the burn's midpoint (s). */
  readonly tS: number;
  /** Δv along the velocity (+ prograde) and along the radius (+ radial out), m/s. */
  readonly progradeMS: number;
  readonly radialMS: number;
}

/** Planner limits (gameplay values). */
export const NODE_LIMITS = {
  /** Largest Δv per component (m/s). */
  maxComponentMS: 1_500,
  /** The node can't be placed sooner than this from now (s): time to turn the ship. */
  minLeadS: 30,
  /** Nor further ahead than this many orbits. */
  maxOrbitsAhead: 3,
} as const;

export interface StateVector {
  readonly r: Vec2;
  readonly v: Vec2;
}

/** Solves Kepler's equation M = E − e·sin E (elliptic). */
function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - M;
    const d = 1 - e * Math.cos(E);
    const step = f / d;
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/**
 * Where a coasting ship will be `dtS` from now on its (bound) two-body orbit, or null for an
 * escape trajectory or a degenerate state. Planar, Earth-centred.
 */
export function propagate(r: Vec2, v: Vec2, dtS: number, mu = EARTH_MU_M3S2): StateVector | null {
  const rr = len(r);
  const vv = len(v);
  if (rr <= 0) return null;
  const energy = (vv * vv) / 2 - mu / rr;
  if (energy >= 0) return null;
  const a = -mu / (2 * energy);
  const h = r[0] * v[1] - r[1] * v[0];
  // Eccentricity vector.
  const rv = dot(r, v);
  const ex = ((vv * vv - mu / rr) * r[0] - rv * v[0]) / mu;
  const ey = ((vv * vv - mu / rr) * r[1] - rv * v[1]) / mu;
  const e = Math.hypot(ex, ey);
  const n = Math.sqrt(mu / (a * a * a));
  // Perifocal frame: P toward periapsis, Q 90° ahead in the direction of motion.
  const sense = Math.sign(h) || 1;
  const P: Vec2 = e > 1e-9 ? [ex / e, ey / e] : [r[0] / rr, r[1] / rr];
  const Q: Vec2 = [-sense * P[1], sense * P[0]];
  const x0 = dot(r, P);
  const y0 = dot(r, Q);
  const E0 = Math.atan2(y0 / (a * Math.sqrt(1 - e * e)), x0 / a + e);
  const M0 = E0 - e * Math.sin(E0);
  const E = eccentricAnomaly(M0 + n * dtS, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e);
  const px = a * (cosE - e);
  const py = b * sinE;
  const rNew = a * (1 - e * cosE);
  const vx = (-a * n * sinE * a) / rNew;
  const vy = (b * n * cosE * a) / rNew;
  return {
    r: [P[0] * px + Q[0] * py, P[1] * px + Q[1] * py],
    v: [P[0] * vx + Q[0] * vy, P[1] * vx + Q[1] * vy],
  };
}

/** The node's Δv as an inertial vector at the node's position and velocity. */
export function nodeDeltaV(at: StateVector, node: ManeuverNode): Vec2 {
  const vv = len(at.v);
  const rr = len(at.r);
  const pro: Vec2 = vv > 0 ? scale(at.v, 1 / vv) : [0, 0];
  const out: Vec2 = rr > 0 ? scale(at.r, 1 / rr) : [0, 0];
  return add(scale(pro, node.progradeMS), scale(out, node.radialMS));
}

export interface NodePlan {
  /** The ship at the node, before and after the (impulsive) burn. */
  readonly at: StateVector;
  readonly after: StateVector;
  readonly dvVec: Vec2;
  readonly dvMS: number;
  /** The orbit after the burn. */
  readonly elements: OrbitalElements;
}

/** The burn's outcome, predicted from the ship's current state at mission time `nowS`. */
export function planNode(r: Vec2, v: Vec2, nowS: number, node: ManeuverNode): NodePlan | null {
  const at = propagate(r, v, node.tS - nowS);
  if (!at) return null;
  const dvVec = nodeDeltaV(at, node);
  const after = { r: at.r, v: add(at.v, dvVec) };
  return { at, after, dvVec, dvMS: len(dvVec), elements: orbitalElements(after.r, after.v) };
}

/**
 * Nose pitch (deg, above the local horizon in the direction of travel, as the flight model
 * measures it) that points along `dir` at position `r`.
 */
export function pitchAlong(r: Vec2, dir: Vec2): number {
  const f = localFrame(r);
  return (Math.atan2(dot(dir, f.up), dot(dir, f.east)) * 180) / Math.PI;
}

/** Burn duration for `dvMS` (s): rocket equation with the given thrust, mass and exhaust speed. */
export function burnTimeS(dvMS: number, massKg: number, thrustN: number, veMS: number): number {
  if (dvMS <= 0) return 0;
  if (thrustN <= 0 || veMS <= 0 || massKg <= 0) return Infinity;
  const mdot = thrustN / veMS;
  const mEnd = massKg / Math.exp(dvMS / veMS);
  return (massKg - mEnd) / mdot;
}

/** A node clamped to the planner's limits, given the current time and orbital period. */
export function clampNode(node: ManeuverNode, nowS: number, periodS: number): ManeuverNode {
  const c = (x: number) =>
    Math.max(-NODE_LIMITS.maxComponentMS, Math.min(NODE_LIMITS.maxComponentMS, x));
  const horizon =
    Number.isFinite(periodS) && periodS > 0 ? periodS * NODE_LIMITS.maxOrbitsAhead : 6 * 3600;
  return {
    tS: Math.min(nowS + horizon, Math.max(nowS + NODE_LIMITS.minLeadS, node.tS)),
    progradeMS: c(node.progradeMS),
    radialMS: c(node.radialMS),
  };
}

/** Handy node times: the next apoapsis and periapsis (or null when the orbit is circular). */
export function nodeTimes(
  r: Vec2,
  v: Vec2,
  nowS: number,
): { apoS: number | null; periS: number | null } {
  const el = orbitalElements(r, v);
  if (el.status === 'escape' || el.eccentricity < 1e-4) return { apoS: null, periS: null };
  const { toApoS, toPeriS } = timeToApsides(r, v, el);
  const lead = NODE_LIMITS.minLeadS;
  const next = (dt: number) => nowS + (dt < lead ? dt + el.periodS : dt);
  return { apoS: next(toApoS), periS: next(toPeriS) };
}
