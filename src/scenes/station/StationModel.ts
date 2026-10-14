import * as THREE from 'three';
import { motionReduced } from '../../render/motion';
import type { ResourceCache } from '../../render/ResourceCache';
import { PORT } from '../../station/proximity';

/*
 * The fictional orbital station: original procedural geometry (no third-party assets).
 *
 * Model frame (right-handed): X = along-track (direction of motion), Y = radial (up, away from
 * Earth), Z = minus cross-track. Station-frame (LVLH) coordinates map with `lvlhToModel`.
 * The forward docking port sits at +X and faces +X.
 */

export function lvlhToModel(
  p: readonly [number, number, number],
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.set(p[1], p[0], -p[2]);
}

function solarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#16264a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#3d5d9a';
    g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 128);
      g.moveTo(0, i);
      g.lineTo(128, i);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StationModel {
  readonly root = new THREE.Group();
  private readonly lights: { mesh: THREE.Mesh; phase: number; period: number }[] = [];

  constructor(cache: ResourceCache) {
    this.root.name = 'station';
    const blanket = cache.material(
      'st:blanket',
      () => new THREE.MeshStandardMaterial({ color: 0xd9dcd6, roughness: 0.75, metalness: 0.1 }),
    );
    const metal = cache.material(
      'st:metal',
      () => new THREE.MeshStandardMaterial({ color: 0x8f969e, roughness: 0.45, metalness: 0.7 }),
    );
    const dark = cache.material(
      'st:dark',
      () => new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.5 }),
    );
    const radiator = cache.material(
      'st:radiator',
      () =>
        new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9, side: THREE.DoubleSide }),
    );
    const solar = cache.material(
      'st:solar',
      () =>
        new THREE.MeshStandardMaterial({
          map: cache.texture('st:solarTex', solarTexture),
          roughness: 0.35,
          metalness: 0.6,
          side: THREE.DoubleSide,
        }),
    );
    const cyl = (r: number, len: number) =>
      cache.geometry(`st:cyl:${r}:${len}`, () =>
        new THREE.CylinderGeometry(r, r, len, 32).rotateZ(Math.PI / 2),
      );
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };

    // Pressurised module chain along X (aft to forward port).
    add(cyl(2.1, 16), blanket, -37); // aft service module
    add(cyl(2.2, 14), blanket, -22);
    add(
      cache.geometry('st:node', () => new THREE.SphereGeometry(2.9, 32, 24)),
      blanket,
      -5,
    );
    add(cyl(2.2, 16), blanket, 8);
    add(cyl(2.0, 9), blanket, 21);
    add(
      cache.geometry('st:node2', () => new THREE.SphereGeometry(2.4, 32, 24)),
      blanket,
      26,
    );
    // Side lab and cupola for a recognisable silhouette.
    add(
      cache.geometry('st:lab', () => new THREE.CylinderGeometry(2, 2, 12, 28)),
      blanket,
      8,
      0,
      0,
    ).position.set(8, -7, 0);
    add(
      cache.geometry('st:cupola', () => new THREE.CylinderGeometry(1, 1.4, 1.6, 8)),
      dark,
      -5,
      -3.4,
      0,
    );

    // Forward port: adapter ring, docking target and approach lights (faces +X).
    add(cyl(1.3, PORT[1] - 28), metal, (PORT[1] + 28) / 2);
    const ring = add(
      cache.geometry('st:ring', () =>
        new THREE.TorusGeometry(1.2, 0.18, 12, 32).rotateY(Math.PI / 2),
      ),
      dark,
      PORT[1],
    );
    ring.name = 'port';
    const target = new THREE.Group();
    target.position.set(PORT[1] - 0.6, 2.6, 0);
    const plate = new THREE.Mesh(
      cache.geometry('st:plate', () => new THREE.PlaneGeometry(1.2, 1.2).rotateY(Math.PI / 2)),
      cache.material(
        'st:plateMat',
        () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      ),
    );
    const crossMat = cache.material(
      'st:cross',
      () => new THREE.MeshBasicMaterial({ color: 0x111111 }),
    );
    const bar = cache.geometry('st:bar', () => new THREE.BoxGeometry(0.05, 0.9, 0.08));
    const post = new THREE.Mesh(
      cache.geometry('st:post', () => new THREE.BoxGeometry(0.06, 0.06, 0.06).scale(1, 1, 1)),
      crossMat,
    );
    post.position.x = 0.5;
    const v1 = new THREE.Mesh(bar, crossMat);
    v1.position.x = 0.02;
    const h1 = new THREE.Mesh(bar, crossMat);
    h1.rotation.x = Math.PI / 2;
    h1.position.x = 0.02;
    target.add(plate, v1, h1, post);
    this.root.add(target);

    // Truss across Z with solar wings and radiators.
    add(
      cache.geometry('st:truss', () => new THREE.BoxGeometry(3, 3, 110)),
      metal,
      -5,
    );
    const wing = cache.geometry('st:wing', () => new THREE.BoxGeometry(34, 0.15, 38));
    for (const z of [-55, 55]) {
      for (const x of [-24, 14]) add(wing, solar, x, 0, z);
      add(
        cache.geometry('st:mast', () => new THREE.BoxGeometry(70, 0.6, 0.6)),
        metal,
        -5,
        0,
        z,
      );
    }
    const rad = cache.geometry('st:rad', () => new THREE.PlaneGeometry(10, 14));
    for (const z of [-14, 14]) {
      const r = add(rad, radiator, -5, 8, z);
      r.rotation.y = Math.PI / 2;
    }

    // Navigation lights: red (minus cross-track side), green, white strobes.
    const light = (color: number, x: number, y: number, z: number, period: number, phase = 0) => {
      const mesh = new THREE.Mesh(
        cache.geometry('st:light', () => new THREE.SphereGeometry(0.35, 12, 8)),
        cache.material(
          `st:light:${color}`,
          () => new THREE.MeshBasicMaterial({ color, fog: false }),
        ),
      );
      mesh.position.set(x, y, z);
      this.root.add(mesh);
      this.lights.push({ mesh, phase, period });
    };
    light(0xff3030, -5, 2, 56, 0);
    light(0x30ff60, -5, 2, -56, 0);
    light(0xffffff, PORT[1], 1.8, 0, 1.5, 0.2);
    light(0xffffff, -45, 2.5, 0, 2, 0.9);
    light(0xffd040, PORT[1] - 0.3, -1.8, 0, 0.8, 0.4);
  }

  /** Blinks the strobes (period 0 = steady). */
  update(time: number): void {
    for (const l of this.lights) {
      // Reduced motion: strobes stay lit instead of flashing.
      l.mesh.visible = l.period === 0 || motionReduced() || (time + l.phase) % l.period < 0.15;
    }
  }
}
