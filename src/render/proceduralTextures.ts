import * as THREE from 'three';

/** Small deterministic PRNG so procedural textures look the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTexture(
  size: number,
  fill: (x: number, y: number) => [number, number, number],
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Offset-row ceramic tile pattern; one texture repeat = one tile row pair. */
export function createTileTexture(): THREE.DataTexture {
  const rand = mulberry32(7);
  const size = 128;
  const shades = Array.from({ length: 64 }, () => 18 + Math.floor(rand() * 12));
  return makeTexture(size, (x, y) => {
    const row = Math.floor(y / 32);
    const offset = row % 2 === 0 ? 0 : 16;
    const col = Math.floor(((x + offset) % size) / 32);
    const lx = (x + offset) % 32;
    const ly = y % 32;
    const grout = lx < 2 || ly < 2;
    const v = grout ? 52 : (shades[(row * 4 + col) % shades.length] ?? 22);
    return [v, v, v + 2];
  });
}

/** Polished concrete with panel joints every texture repeat. */
export function createConcreteTexture(): THREE.DataTexture {
  const rand = mulberry32(42);
  const size = 256;
  const noise = Float32Array.from({ length: size * size }, () => rand());
  return makeTexture(size, (x, y) => {
    const n = noise[y * size + x] ?? 0;
    const blotch = Math.sin(x * 0.05) * Math.cos(y * 0.043) * 6;
    const joint = x < 2 || y < 2 ? -28 : 0;
    const v = Math.max(0, Math.min(255, 92 + n * 16 + blotch + joint));
    return [v, v * 0.98, v * 0.95];
  });
}

/** Diagonal black/yellow hazard stripes. */
export function createHazardTexture(): THREE.DataTexture {
  return makeTexture(64, (x, y) => ((x + y) % 64 < 32 ? [230, 170, 30] : [24, 24, 24]));
}

/** Vertical soot streaks and heat tint for the weathered hull finish (multiplied over the hull). */
export function createSootTexture(): THREE.DataTexture {
  const rand = mulberry32(13);
  const size = 256;
  const columns = Float32Array.from({ length: size }, () => rand());
  return makeTexture(size, (x, y) => {
    const streak = Math.pow(columns[x] ?? 0, 6) * 120 * (1 - y / size);
    const band = Math.sin((y / size) * Math.PI * 6) * 6;
    const v = Math.max(90, Math.min(255, 238 - streak + band));
    return [v, v * 0.97, v * 0.92];
  });
}
