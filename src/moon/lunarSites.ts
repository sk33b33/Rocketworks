import { MOON_RADIUS_M } from './moonOrbit';

/*
 * Fictional lunar landing sites on the near side, with deterministic procedural terrain. Every
 * site lies in the game's single orbital plane; positions are selenographic angles (0 = the
 * sub-Earth point, positive eastward). Terrain heights are relative to the Moon's mean radius
 * and are used both by the physics (touchdown, slopes) and by the 3D terrain. Game values.
 */

export type HazardLevel = 'low' | 'moderate' | 'high';

export interface LunarSite {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Selenographic angle of the target (radians). */
  readonly seleno: number;
  readonly hazard: HazardLevel;
  /** 0..1 terrain roughness (undulation amplitude, crater count). */
  readonly roughness: number;
  /** Boulder fields: chance per 8 m cell of a boulder big enough to tilt the legs. */
  readonly boulderDensity: number;
  readonly lighting: string;
  readonly seed: number;
}

export const LUNAR_SITES: readonly LunarSite[] = [
  {
    id: 'sea-of-calm',
    name: 'Sea of Calm',
    description: 'A broad, old lava plain: gentle slopes and few boulders. The safe first choice.',
    seleno: -0.32,
    hazard: 'low',
    roughness: 0.25,
    boulderDensity: 0.004,
    lighting: 'Low sun from the east; long shadows help judge height.',
    seed: 11,
  },
  {
    id: 'aurora-highlands',
    name: 'Aurora Highlands',
    description:
      'Rolling highland terrain with scattered craters. Moderate slopes, richer geology.',
    seleno: 0.22,
    hazard: 'moderate',
    roughness: 0.55,
    boulderDensity: 0.012,
    lighting: 'Sun high overhead; contrast is flat.',
    seed: 23,
  },
  {
    id: 'halcyon-rim',
    name: 'Halcyon Crater Rim',
    description:
      'The terraced rim of a young crater: ancient deep rock exposed, but steep and blocky.',
    seleno: 0.55,
    hazard: 'high',
    roughness: 0.9,
    boulderDensity: 0.03,
    lighting: 'Sun low in the west; the crater floor is in shadow.',
    seed: 37,
  },
  {
    id: 'lantern-ridge',
    name: 'Lantern Ridge',
    description: 'A ridge near the eastern limb with Earth low on the horizon. Rough and remote.',
    seleno: 1.12,
    hazard: 'high',
    roughness: 0.8,
    boulderDensity: 0.025,
    lighting: 'Grazing sunlight; Earth sits on the horizon.',
    seed: 53,
  },
];

export function findLunarSite(id: string | null | undefined): LunarSite | undefined {
  return LUNAR_SITES.find((s) => s.id === id);
}

export const DEFAULT_SITE_ID = 'sea-of-calm';

export const HAZARD_LABELS: Record<HazardLevel, string> = {
  low: 'Low hazard',
  moderate: 'Moderate hazard',
  high: 'High hazard',
};

// ---- deterministic noise ----

function hash(n: number, seed: number): number {
  let x = Math.imul((n | 0) ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

interface Crater {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
}

/** Terrain around one site: along-track x (m, + = east of the target) and cross-track z (m). */
export class SiteTerrain {
  private readonly craters: Crater[] = [];
  readonly halfSpanM = 40_000;

  constructor(readonly site: LunarSite) {
    const n = Math.round(30 + site.roughness * 70);
    for (let i = 0; i < n; i++) {
      const radius = 30 + hash(i * 4 + 2, site.seed) ** 2 * (200 + site.roughness * 900);
      this.craters.push({
        x: (hash(i * 4, site.seed) * 2 - 1) * this.halfSpanM,
        z: (hash(i * 4 + 1, site.seed) * 2 - 1) * 3_000,
        radius,
        depth: radius * (0.12 + hash(i * 4 + 3, site.seed) * 0.1),
      });
    }
    // Small fresh craters around the target: rougher sites have many, close in.
    const local = Math.round(site.roughness * 30);
    for (let i = 0; i < local; i++) {
      const k = 1_000 + i * 4;
      const radius = 10 + hash(k + 2, site.seed) * 70;
      this.craters.push({
        x: (hash(k, site.seed) * 2 - 1) * 700,
        z: (hash(k + 1, site.seed) * 2 - 1) * 140,
        radius,
        depth: radius * (0.16 + hash(k + 3, site.seed) * 0.1),
      });
    }
    // The low-hazard site was picked for its clear target: keep crater bowls away from it.
    if (site.hazard === 'low') {
      for (let i = 0; i < this.craters.length; i++) {
        const c = this.craters[i]!;
        if (Math.hypot(c.x, c.z) < c.radius * 1.4 + 150)
          this.craters[i] = { ...c, x: c.x + Math.sign(c.x || 1) * (c.radius * 1.6 + 300) };
      }
    }
  }

  /** Terrain height (m above the mean radius) at (x, z). */
  heightAt(x: number, z = 0): number {
    const r = this.site.roughness;
    const s = this.site.seed;
    let h =
      14 * r * Math.sin(x / 2_300 + s) +
      6 * r * Math.sin(x / 760 + s * 1.7) * Math.cos(z / 900 + s) +
      2.2 * r * Math.sin(x / 210 + s * 2.3) +
      3 * r * Math.sin(z / 420 + s * 0.7);
    for (const c of this.craters) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > c.radius * 2.2) continue;
      const q = d / c.radius;
      h += q < 1 ? -c.depth * (1 - q * q) : 0;
      h += 0.3 * c.depth * Math.exp(-(((d - c.radius) / (0.35 * c.radius)) ** 2));
    }
    return h;
  }

  /** Boulder (if any) in the 8 m cell around x on the landing line: its height in metres. */
  boulderAt(x: number, z = 0): number {
    const cx = Math.floor(x / 8);
    const cz = Math.floor(z / 8);
    const p = hash(cx * 7_919 + cz * 104_729, this.site.seed + 5);
    if (p > this.site.boulderDensity) return 0;
    return 0.6 + hash(cx * 31 + cz * 17, this.site.seed + 9) * 2.4;
  }

  /** Ground slope (deg) at x, including the tilt a boulder under a leg would add. */
  slopeAt(x: number): number {
    const d = 4; // leg spread: half the footprint
    const g = Math.atan(Math.abs(this.heightAt(x + d) - this.heightAt(x - d)) / (2 * d));
    const boulder = Math.max(this.boulderAt(x - d), this.boulderAt(x + d));
    return ((g + Math.atan(boulder / (2 * d))) * 180) / Math.PI;
  }

  /** Along-track offset (m) of a selenographic angle from the site target. */
  offsetOf(seleno: number): number {
    let a = seleno - this.site.seleno;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a * MOON_RADIUS_M;
  }

  /**
   * The safest touchdown point within `radiusM` of `aroundM` (along-track): low slope, close to
   * the aim. Used by the landing assist's hazard avoidance.
   */
  safestNear(aroundM: number, radiusM = 400, stepM = 8): { x: number; slopeDeg: number } {
    let best = { x: aroundM, slopeDeg: this.slopeAt(aroundM), score: Infinity };
    for (let x = aroundM - radiusM; x <= aroundM + radiusM; x += stepM) {
      const slope = Math.max(this.slopeAt(x - 6), this.slopeAt(x), this.slopeAt(x + 6));
      const score = slope + Math.abs(x - aroundM) / 120;
      if (score < best.score) best = { x, slopeDeg: slope, score };
    }
    return { x: best.x, slopeDeg: best.slopeDeg };
  }

  /** Share of ground within `radiusM` of the target steeper than `limitDeg` (0..1). */
  steepShare(radiusM = 500, limitDeg = 9): number {
    let n = 0;
    let total = 0;
    for (let x = -radiusM; x <= radiusM; x += 4) {
      total++;
      if (this.slopeAt(x) > limitDeg) n++;
    }
    return n / total;
  }

  /** Slope profile for the HUD strip: samples from `fromM` to `toM`. */
  profile(fromM: number, toM: number, samples = 80): { x: number; h: number; slopeDeg: number }[] {
    const out: { x: number; h: number; slopeDeg: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const x = fromM + ((toM - fromM) * i) / samples;
      out.push({ x, h: this.heightAt(x), slopeDeg: this.slopeAt(x) });
    }
    return out;
  }
}

/** Physics terrain for the gravity environment (selenographic angle → height/slope). */
export function terrainEnv(t: SiteTerrain): {
  heightAt: (seleno: number) => number;
  slopeAt: (seleno: number) => number;
} {
  return {
    heightAt: (seleno) => {
      const x = t.offsetOf(seleno);
      return Math.abs(x) < t.halfSpanM ? t.heightAt(x) : 0;
    },
    slopeAt: (seleno) => {
      const x = t.offsetOf(seleno);
      return Math.abs(x) < t.halfSpanM ? t.slopeAt(x) : 5;
    },
  };
}
