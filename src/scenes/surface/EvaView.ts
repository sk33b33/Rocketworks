import * as THREE from 'three';
import type { ResourceCache } from '../../render/ResourceCache';
import { autoMotion } from '../../render/motion';
import { SHIP_CLEARANCE_M, type EvaState } from '../../surface/eva';
import type { TerrainPatch } from '../moon/TerrainPatch';

/*
 * The EVA on the Moon or Mars: an astronaut (original procedural model), the sample beacons and
 * a follow camera. Everything sits in the landing site's terrain-patch frame (X along track,
 * Y up, Z across), so it stands on the ground the patch draws. Shared geometries and materials
 * come from the scene's resource cache, which disposes them with the scene.
 */

const SAMPLE_SLOTS = 6;

export class EvaView {
  readonly root = new THREE.Group();
  private readonly astronaut = new THREE.Group();
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly beacons: THREE.Group[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private stride = 0;

  constructor(cache: ResourceCache) {
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    const suit = cache.material(
      'eva:suit',
      () => new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8 }),
    );
    const dark = cache.material(
      'eva:dark',
      () => new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.7 }),
    );
    const visor = cache.material(
      'eva:visor',
      () => new THREE.MeshStandardMaterial({ color: 0xc8962e, metalness: 0.9, roughness: 0.15 }),
    );
    const stripe = cache.material(
      'eva:stripe',
      () => new THREE.MeshStandardMaterial({ color: 0xd9541e, roughness: 0.6 }),
    );
    const box = (key: string, w: number, h: number, d: number) =>
      cache.geometry(`eva:${key}`, () => new THREE.BoxGeometry(w, h, d));
    const torso = new THREE.Mesh(box('torso', 0.5, 0.62, 0.34), suit);
    torso.position.y = 1.15;
    const pack = new THREE.Mesh(box('pack', 0.46, 0.66, 0.24), suit);
    pack.position.set(-0.28, 1.2, 0);
    const band = new THREE.Mesh(box('band', 0.52, 0.06, 0.36), stripe);
    band.position.y = 1.32;
    const helmet = new THREE.Mesh(
      cache.geometry('eva:helmet', () => new THREE.SphereGeometry(0.2, 20, 14)),
      suit,
    );
    helmet.position.y = 1.62;
    const face = new THREE.Mesh(
      cache.geometry(
        'eva:visor',
        () => new THREE.SphereGeometry(0.205, 20, 14, -Math.PI / 2.6, Math.PI / 1.3, 0.7, 1.2),
      ),
      visor,
    );
    face.position.y = 1.62;
    // Limbs pivot at the hip and shoulder.
    const limb = (len: number, w: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const m = new THREE.Mesh(box(`limb${len}${w}`, w, len, w), mat);
      m.position.y = -len / 2;
      pivot.add(m);
      return pivot;
    };
    this.legL = limb(0.84, 0.17, suit, 0, 0.86, 0.12);
    this.legR = limb(0.84, 0.17, suit, 0, 0.86, -0.12);
    this.armL = limb(0.62, 0.13, suit, 0, 1.4, 0.32);
    this.armR = limb(0.62, 0.13, suit, 0, 1.4, -0.32);
    const bootL = new THREE.Mesh(box('boot', 0.28, 0.1, 0.18), dark);
    bootL.position.set(0.04, -0.84, 0);
    this.legL.add(bootL);
    const bootR = bootL.clone();
    this.legR.add(bootR);
    // The model faces +X (its heading).
    face.rotation.y = 0;
    this.astronaut.add(torso, pack, band, helmet, face, this.legL, this.legR, this.armL, this.armR);
    this.root.add(this.astronaut);

    const rock = cache.geometry('eva:rock', () => new THREE.IcosahedronGeometry(0.3, 0));
    const rockMat = cache.material(
      'eva:rock',
      () => new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 1, flatShading: true }),
    );
    const pole = cache.geometry('eva:pole', () => new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6));
    const lamp = cache.geometry('eva:lamp', () => new THREE.SphereGeometry(0.16, 12, 8));
    const lampMat = cache.material(
      'eva:lamp',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0xffa630,
          emissive: 0xff8a00,
          emissiveIntensity: 1.6,
        }),
    );
    const flag = cache.geometry('eva:flag', () => new THREE.BoxGeometry(0.5, 0.3, 0.02));
    for (let i = 0; i < SAMPLE_SLOTS; i++) {
      const g = new THREE.Group();
      const r = new THREE.Mesh(rock, rockMat);
      r.position.y = 0.15;
      const p = new THREE.Mesh(pole, dark);
      p.position.set(0.5, 1.2, 0);
      const l = new THREE.Mesh(lamp, lampMat);
      l.position.set(0.5, 2.45, 0);
      const f = new THREE.Mesh(flag, stripe);
      f.position.set(0.76, 2.1, 0);
      g.add(r, p, l, f);
      g.visible = false;
      this.beacons.push(g);
      this.root.add(g);
    }
  }

  /** Places everything for this frame (hidden when no one is outside or the patch is missing). */
  update(eva: EvaState | null, patch: TerrainPatch | null, time: number, dtS: number): void {
    patch?.setRingsHidden(!!eva);
    if (!eva || !patch || !patch.group.visible) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    patch.group.updateWorldMatrix(true, false);
    this.root.matrix.copy(patch.group.matrixWorld);
    this.root.matrixWorldNeedsUpdate = true;
    // A loping walk: low gravity means long, bouncing strides.
    if (eva.moving) this.stride += dtS * (eva.body === 'moon' ? 5 : 6.5);
    const swing = eva.moving ? Math.sin(this.stride) * 0.55 : 0;
    const hop = eva.moving
      ? Math.abs(Math.sin(this.stride)) * (eva.body === 'moon' ? 0.22 : 0.08)
      : 0;
    this.legL.rotation.z = swing;
    this.legR.rotation.z = -swing;
    this.armL.rotation.z = -swing * 0.7;
    this.armR.rotation.z = swing * 0.7;
    this.astronaut.position.set(eva.x, patch.localY(eva.x, eva.z) + hop, eva.z);
    // Heading h points along (cos h, sin h) in (x, z); the model faces +X.
    this.astronaut.rotation.y = -eva.heading;
    eva.samples.forEach((s, i) => {
      const b = this.beacons[i];
      if (!b) return;
      b.visible = s.progress < 1;
      b.position.set(s.x, patch.localY(s.x, s.z), s.z);
      b.scale.setScalar(1 + autoMotion(Math.sin(time * 3 + i)) * 0.04);
    });
    for (let i = eva.samples.length; i < this.beacons.length; i++) this.beacons[i]!.visible = false;
  }

  /** Follow camera behind and above the astronaut (call after `update`). */
  applyCamera(camera: THREE.PerspectiveCamera, eva: EvaState, patch: TerrainPatch): void {
    const back = 7;
    let cx = eva.x - Math.cos(eva.heading) * back;
    let cz = eva.z - Math.sin(eva.heading) * back;
    // Never inside the ship: push the camera out to the clearance radius around its axis.
    const off = Math.hypot(cx - eva.shipX, cz - eva.shipZ);
    if (off < SHIP_CLEARANCE_M) {
      const ux = off > 1e-3 ? (cx - eva.shipX) / off : -Math.cos(eva.heading);
      const uz = off > 1e-3 ? (cz - eva.shipZ) / off : -Math.sin(eva.heading);
      cx = eva.shipX + ux * SHIP_CLEARANCE_M;
      cz = eva.shipZ + uz * SHIP_CLEARANCE_M;
    }
    const ground = Math.max(patch.localY(cx, cz), patch.localY(eva.x, eva.z));
    const local = this.tmp.set(cx, ground + 3.2, cz);
    const look = this.tmp2.set(eva.x, patch.localY(eva.x, eva.z) + 1.3, eva.z);
    const m = patch.group.matrixWorld;
    camera.position.copy(local.applyMatrix4(m));
    camera.up.set(0, 1, 0).transformDirection(m);
    camera.lookAt(look.applyMatrix4(m));
    camera.near = 0.5;
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}
