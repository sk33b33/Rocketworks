import * as THREE from 'three';
import { ENGINE_BELL_LENGTH_M } from '../../rocket/model/geometry';
import type { ResourceCache } from '../../render/ResourceCache';
import { mulberry32 } from '../../shared/random';

/** Engine plumes, launch smoke and a loss-of-vehicle fireball. Simple additive meshes. */

export interface Plume {
  readonly root: THREE.Group;
  readonly core: THREE.Mesh;
  readonly outer: THREE.Mesh;
}

export function createPlume(cache: ResourceCache): Plume {
  const geo = cache.geometry('fx:plume', () =>
    new THREE.CylinderGeometry(1.25, 0.72, 1, 18, 1, true).translate(0, 0.5, 0),
  );
  const coreMat = cache.material(
    'fx:plumeCore',
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffe2a8,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
  );
  const outerMat = cache.material(
    'fx:plumeOuter',
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xff7a30,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
  );
  const root = new THREE.Group();
  root.position.y = ENGINE_BELL_LENGTH_M - 0.1;
  root.userData.helper = true;
  const core = new THREE.Mesh(geo, coreMat);
  const outer = new THREE.Mesh(geo, outerMat);
  core.scale.set(0.7, 10, 0.7);
  outer.scale.set(1.3, 18, 1.3);
  root.add(core, outer);
  root.visible = false;
  return { root, core, outer };
}

/** Plume size from throttle and altitude (plumes balloon in thin air). Flicker comes from `time`. */
export function updatePlume(
  p: Plume,
  on: boolean,
  throttle: number,
  altitudeM: number,
  time: number,
  seed: number,
): void {
  p.root.visible = on && throttle > 0;
  if (!p.root.visible) return;
  const expand = 1 + Math.min(3, altitudeM / 30_000);
  // Thin air: the plume widens but becomes fainter (shared materials, same altitude per stage).
  const faint = 1 / Math.sqrt(expand);
  (p.core.material as THREE.MeshBasicMaterial).opacity = 0.7 * faint;
  (p.outer.material as THREE.MeshBasicMaterial).opacity = 0.3 * faint * faint;
  const flicker = 1 + Math.sin(time * 37 + seed * 3.1) * 0.06 + Math.sin(time * 61 + seed) * 0.04;
  const len = (8 + 26 * throttle) * flicker;
  p.core.scale.set(0.7 * expand, len * 0.45, 0.7 * expand);
  p.outer.scale.set(1.3 * expand, len * (1 + expand * 0.25), 1.3 * expand);
}

interface Puff {
  readonly mesh: THREE.Mesh;
  readonly dir: THREE.Vector3;
  readonly speed: number;
}

/** Billowing ground cloud from the flame trench, started at ignition. */
export class LaunchSmoke {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private age = -1;

  constructor(private readonly cache: ResourceCache) {
    this.group.visible = false;
  }

  start(): void {
    this.clear();
    const rand = mulberry32(21);
    const geo = this.cache.geometry('fx:puff', () => new THREE.IcosahedronGeometry(1, 1));
    for (let i = 0; i < 42; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: 0xd9d6d0,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const a = (i / 42) * Math.PI * 2 + rand() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), 0.15 + rand() * 0.25, Math.sin(a));
      if (i % 3 === 0) dir.set(0.2 * (rand() - 0.5), 0.1, 1); // the trench exit points +Z
      mesh.position.set(0, 3, 0);
      this.group.add(mesh);
      this.puffs.push({ mesh, dir: dir.normalize(), speed: 12 + rand() * 18 });
    }
    this.age = 0;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (this.age < 0) return;
    this.age += dt;
    const fade = Math.max(0, 1 - this.age / 45);
    for (const p of this.puffs) {
      const slow = Math.exp(-this.age / 8);
      p.mesh.position.addScaledVector(p.dir, p.speed * slow * dt);
      p.mesh.position.y += dt * 1.5;
      p.mesh.scale.setScalar(6 + this.age * 2.2);
      (p.mesh.material as THREE.MeshLambertMaterial).opacity = 0.7 * fade;
    }
    if (fade <= 0) this.clear();
  }

  clear(): void {
    for (const p of this.puffs) {
      (p.mesh.material as THREE.Material).dispose();
      p.mesh.removeFromParent();
    }
    this.puffs = [];
    this.age = -1;
    this.group.visible = false;
  }
}

/** Expanding fireball and smoke for a loss of vehicle. */
export class Fireball {
  readonly group = new THREE.Group();
  private age = -1;
  private readonly fire: THREE.Mesh;
  private readonly smoke: THREE.Mesh;

  constructor(cache: ResourceCache) {
    const geo = cache.geometry('fx:fireball', () => new THREE.IcosahedronGeometry(1, 2));
    this.fire = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffa040,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.smoke = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: 0x3a3632,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    this.group.add(this.smoke, this.fire);
    this.group.visible = false;
  }

  trigger(at: THREE.Vector3): void {
    this.group.position.copy(at);
    this.age = 0;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (this.age < 0) return;
    this.age += dt;
    const t = this.age;
    this.fire.scale.setScalar(10 + 90 * Math.min(1, t / 1.5));
    (this.fire.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 2.5);
    this.smoke.scale.setScalar(20 + 70 * Math.min(1, t / 4));
    (this.smoke.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 0.8 - t / 12);
    if (t > 12) {
      this.group.visible = false;
      this.age = -1;
    }
  }

  dispose(): void {
    (this.fire.material as THREE.Material).dispose();
    (this.smoke.material as THREE.Material).dispose();
  }
}
