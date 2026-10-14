import * as THREE from 'three';
import { fbm, memoCanvas, texelDirection } from '../flight/earthTextures';

/*
 * Procedural Moon surface (original art, no third-party imagery): grey highlands, darker maria
 * concentrated on the near side, and a scatter of bright-rimmed craters with rays. Uses the same
 * equirectangular convention as the Earth texture, so selenographic angle = atan2(x, y) of the
 * texel direction in the Moon's own frame (0 = the side facing Earth).
 */

function hash(n: number): number {
  let x = Math.imul(n ^ 0x5bd1e995, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function createMoonTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const canvas = memoCanvas(`moon:${width}x${height}`, () => paintMoon(width, height));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintMoon(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(width, height);
    const data = img.data;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const d = texelDirection((i + 0.5) / width, (j + 0.5) / height);
        const lon = Math.atan2(d[0], d[1]);
        const n = fbm(d[0] * 4 + 3, d[1] * 4 + 9, d[2] * 4 + 1, 77, 5);
        const fine = fbm(d[0] * 24, d[1] * 24, d[2] * 24, 13, 3);
        // Maria: large dark basins, mostly on the near side.
        const nearSide = Math.max(0, Math.cos(lon)) ** 0.7;
        const mare =
          Math.max(
            0,
            Math.min(1, (fbm(d[0] * 2.2 + 5, d[1] * 2.2, d[2] * 2.2 + 7, 31, 4) - 0.52) * 7),
          ) * nearSide;
        let g = 150 + (n - 0.5) * 70 + (fine - 0.5) * 30;
        g = g * (1 - 0.45 * mare);
        const k = (j * width + i) * 4;
        data[k] = g;
        data[k + 1] = g * 0.985;
        data[k + 2] = g * 0.96;
        data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Craters: dark floors, bright rims; a few young ones with rays.
    for (let c = 0; c < 520; c++) {
      const u = hash(c * 3 + 1);
      const v = 0.08 + hash(c * 3 + 2) * 0.84;
      const lat = Math.abs(v - 0.5) * Math.PI;
      const r = (1 + hash(c * 3 + 3) ** 3 * 22) * (height / 512);
      const x = u * width;
      const y = v * height;
      const sx = 1 / Math.max(0.2, Math.cos(lat));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, 1);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 38, 36, 0.28)';
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, r * 0.18);
      ctx.strokeStyle = 'rgba(235, 232, 225, 0.32)';
      ctx.stroke();
      if (c % 47 === 0) {
        ctx.strokeStyle = 'rgba(240, 238, 232, 0.12)';
        ctx.lineWidth = 1;
        for (let k = 0; k < 14; k++) {
          const a = hash(c * 31 + k) * Math.PI * 2;
          const len = r * (3 + hash(c * 17 + k) * 6);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  return canvas;
}

/** Ground texture for the close-up terrain patch: fine regolith speckle, tiled. */
export function createRegolithTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const a = (i / size) * Math.PI * 2;
        const b = (j / size) * Math.PI * 2;
        // Tileable: sample noise on a torus.
        const n = fbm(Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(b) * 3 + Math.sin(b) * 2, 3, 5);
        const g = 120 + (n - 0.5) * 90 + (hash(i * 7_919 + j) - 0.5) * 26;
        const k = (j * size + i) * 4;
        img.data[k] = g;
        img.data[k + 1] = g * 0.98;
        img.data[k + 2] = g * 0.95;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
