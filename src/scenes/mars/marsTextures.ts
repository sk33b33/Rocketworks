import * as THREE from 'three';
import { fbm, memoCanvas, texelDirection } from '../flight/earthTextures';

/*
 * Procedural Mars (original art, no third-party imagery): rust-orange plains, darker basaltic
 * regions, a bright polar cap, dust-softened craters and a long canyon scar. Same
 * equirectangular convention as the Earth and Moon textures (texel direction in the planet's
 * frame; the orbital plane is the equator).
 */

function hash(n: number): number {
  let x = Math.imul(n ^ 0x2c1b3c6d, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function createMarsTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const canvas = memoCanvas(`mars:${width}x${height}`, () => paintMars(width, height));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintMars(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const d = texelDirection((i + 0.5) / width, (j + 0.5) / height);
      const lat = Math.asin(Math.max(-1, Math.min(1, d[2])));
      const n = fbm(d[0] * 3 + 11, d[1] * 3 + 2, d[2] * 3 + 5, 51, 5);
      const fine = fbm(d[0] * 20, d[1] * 20, d[2] * 20, 9, 3);
      // Dark basaltic regions.
      const dark = Math.max(
        0,
        Math.min(1, (fbm(d[0] * 1.8 + 4, d[1] * 1.8 + 1, d[2] * 1.8 + 8, 23, 4) - 0.54) * 6),
      );
      // A long canyon scar just south of the equator.
      const lon = Math.atan2(d[0], d[1]);
      const canyon = lon > -1.6 && lon < -0.4 ? Math.exp(-(((lat + 0.12) / 0.018) ** 2)) * 0.6 : 0;
      let r = 190 + (n - 0.5) * 70 + (fine - 0.5) * 24;
      let g = 104 + (n - 0.5) * 40 + (fine - 0.5) * 14;
      let b = 62 + (n - 0.5) * 22;
      const shade = 1 - 0.42 * dark - canyon;
      r *= shade;
      g *= shade;
      b *= shade * 1.05;
      // Polar caps (the northern one larger), fading at the edge.
      const cap = Math.max(0, Math.min(1, (Math.abs(lat) - (lat > 0 ? 1.18 : 1.3)) * 9));
      r = r * (1 - cap) + 238 * cap;
      g = g * (1 - cap) + 232 * cap;
      b = b * (1 - cap) + 226 * cap;
      const k = (j * width + i) * 4;
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Craters: dust-softened, darker floors.
  for (let c = 0; c < 320; c++) {
    const u = hash(c * 3 + 1);
    const v = 0.15 + hash(c * 3 + 2) * 0.7;
    const lat = Math.abs(v - 0.5) * Math.PI;
    const rad = (1 + hash(c * 3 + 3) ** 3 * 18) * (height / 512);
    ctx.save();
    ctx.translate(u * width, v * height);
    ctx.scale(1 / Math.max(0.2, Math.cos(lat)), 1);
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(70, 34, 20, 0.22)';
    ctx.fill();
    ctx.lineWidth = Math.max(0.6, rad * 0.15);
    ctx.strokeStyle = 'rgba(232, 170, 120, 0.22)';
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}
