/*
 * Landing precision rating (S–D) shared by booster catches, booster landings and ship landings.
 * Each metric is scored against the limit for a safe outcome; the grade is a weighted blend.
 */

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface LandingMetrics {
  /** Distance from the target point (m). */
  readonly missM: number;
  readonly vertMS: number;
  readonly horizMS: number;
  readonly tiltDeg: number;
}

export interface RatingLimits {
  /** Miss distance that still counts as on target. */
  readonly missM: number;
  readonly vertMS: number;
  readonly horizMS: number;
  readonly tiltDeg: number;
}

export interface Rating {
  readonly grade: Grade;
  /** 0..100 */
  readonly score: number;
}

const WEIGHTS = { miss: 0.4, vert: 0.3, horiz: 0.15, tilt: 0.15 } as const;

/** Rates a successful touchdown or capture. Pure. */
export function rateLanding(m: LandingMetrics, limits: RatingLimits): Rating {
  const part = (value: number, limit: number) =>
    Math.max(0, 1 - Math.abs(value) / Math.max(1e-6, limit));
  const score =
    100 *
    (WEIGHTS.miss * part(m.missM, limits.missM) +
      WEIGHTS.vert * part(m.vertMS, limits.vertMS) +
      WEIGHTS.horiz * part(m.horizMS, limits.horizMS) +
      WEIGHTS.tilt * part(m.tiltDeg, limits.tiltDeg));
  const grade: Grade =
    score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D';
  return { grade, score: Math.round(score) };
}

export function gradeAtLeast(grade: Grade | null | undefined, min: Grade): boolean {
  const order: Grade[] = ['D', 'C', 'B', 'A', 'S'];
  return !!grade && order.indexOf(grade) >= order.indexOf(min);
}
