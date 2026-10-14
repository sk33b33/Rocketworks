import * as THREE from 'three';
import { COAST_HALF_WIDTH_RAD } from '../../flight/landingZones';

/*
 * Procedural Earth: original equirectangular colour and cloud textures from seeded 3D value
 * noise (no third-party imagery). The planet's equator lies in the simulation plane; ground
 * angle 0 (the launch site) gets a coastline, and the rest of the ground track stays ocean so
 * the map matches the simplified landing geography.
 */

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

/** Fractal noise in roughly [0, 1]. */
export function fbm(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * Scene-space unit direction of a texel. Matches a SphereGeometry rotated +90° about X, so the
 * texture's equator lies in the XY (simulation) plane and ground angle a = atan2(x, y).
 */
export function texelDirection(u: number, v: number): [number, number, number] {
  const theta = 2 * Math.PI * u;
  const t = Math.PI * v;
  return [-Math.cos(theta) * Math.sin(t), -Math.sin(theta) * Math.sin(t), Math.cos(t)];
}

/** Land height in [-1, 1] (positive = land) for a unit direction. Deterministic. */
export function landHeight(d: readonly [number, number, number]): number {
  const [x, y, z] = d;
  let h = fbm(x * 1.6 + 7, y * 1.6 + 3, z * 1.6 + 11, 42) * 2 - 1.06;
  const groundAngle = Math.atan2(x, y);
  const lat = Math.asin(Math.max(-1, Math.min(1, z)));
  // Keep the ground track (equator) open ocean, except for the launch coast.
  const band = Math.exp(-((lat / 0.12) ** 2));
  h -= band * 0.5;
  // The launch coast (land within the coast half-width) and open ocean elsewhere on the track.
  const nearSite = Math.hypot(groundAngle / COAST_HALF_WIDTH_RAD, lat / 0.08);
  if (nearSite < 1) h = Math.max(h, 0.15 * (1 - nearSite) + 0.02);
  else if (Math.abs(lat) < 0.03) h = Math.min(h, -0.05);
  return h;
}

/**
 * Generated canvases are memoized for the whole session: several scenes show Earth (and the
 * Moon), and generating the pixels is the expensive part. Each scene still wraps the canvas in
 * its own texture, so per-scene disposal stays independent.
 */
const canvasMemo = new Map<string, HTMLCanvasElement>();
export function memoCanvas(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = canvasMemo.get(key);
  if (!c) {
    c = make();
    canvasMemo.set(key, c);
  }
  return c;
}

function paint(
  width: number,
  height: number,
  fill: (u: number, v: number) => number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const rgba = fill((i + 0.5) / width, (j + 0.5) / height);
      const k = (j * width + i) * 4;
      data[k] = (rgba >>> 24) & 255;
      data[k + 1] = (rgba >>> 16) & 255;
      data[k + 2] = (rgba >>> 8) & 255;
      data[k + 3] = rgba & 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const rgba = (r: number, g: number, b: number, a = 255) =>
  ((Math.round(r) & 255) << 24) |
  ((Math.round(g) & 255) << 16) |
  ((Math.round(b) & 255) << 8) |
  (Math.round(a) & 255);

export function createEarthTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const canvas = memoCanvas(`earth:${width}x${height}`, () => paintEarth(width, height));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintEarth(width: number, height: number): HTMLCanvasElement {
  return paint(width, height, (u, v) => {
    const d = texelDirection(u, v);
    const h = landHeight(d);
    const lat = Math.abs(Math.asin(d[2]));
    // Polar ice with a soft, noise-perturbed edge.
    const iceEdge = 1.32 + (fbm(d[0] * 6 + 3, d[1] * 6, d[2] * 6, 5, 4) - 0.5) * 0.18;
    const ice = Math.min(1, Math.max(0, (lat - iceEdge) / 0.05));
    const mixIce = (r: number, g: number, b: number) =>
      rgba(r + (232 - r) * ice, g + (238 - g) * ice, b + (244 - b) * ice);
    if (h <= 0) {
      // Ocean: shallow shelves are lighter.
      const shelf = Math.max(0, 1 + h * 8);
      return mixIce(14 + 30 * shelf, 46 + 60 * shelf, 92 + 50 * shelf);
    }
    const n = fbm(d[0] * 9, d[1] * 9, d[2] * 9, 7, 3);
    const dry = Math.min(1, Math.max(0, 1 - lat * 1.4 + (n - 0.5)));
    const high = Math.min(1, h * 3);
    const r = 62 + 110 * dry + 40 * high;
    const g = 92 + 60 * dry + 30 * high;
    const b = 48 + 40 * dry + 30 * high;
    return mixIce(r, g, b);
  });
}

export function createCloudTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const canvas = memoCanvas(`clouds:${width}x${height}`, () => paintClouds(width, height));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintClouds(width: number, height: number): HTMLCanvasElement {
  return paint(width, height, (u, v) => {
    const d = texelDirection(u, v);
    const n = fbm(d[0] * 3 + 21, d[1] * 3 + 5, d[2] * 6 + 9, 99, 5);
    const a = Math.max(0, Math.min(1, (n - 0.5) * 3.2));
    return rgba(255, 255, 255, a * 230);
  });
}
