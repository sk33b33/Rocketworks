import * as THREE from 'three';
import { MOON_RADIUS_M } from '../../moon/moonOrbit';
import type { SiteTerrain, TerrainSite } from '../../moon/lunarSites';
import type { ResourceCache } from '../../render/ResourceCache';
import { createRegolithTexture } from './moonTextures';

/*
 * High-detail terrain around the chosen landing site, built from the same SiteTerrain the physics
 * uses (so the ship sits on what you see). Local frame: X = along-track (east), Y = up at the
 * target, Z = across the track; the patch's origin is the target point on the surface. Edges
 * sink into a skirt so the slightly lowered Moon sphere shows beyond it.
 */

const HALF_X = 8_000;
const HALF_Z = 3_000;
const SEG_X = 256;
const SEG_Z = 96;
/** The Moon sphere is drawn this much lower while the patch is shown. */
export const SPHERE_SINK_M = 500;

/** How the patch looks and curves (the Moon by default; Mars passes its own). */
export interface PatchStyle {
  readonly key: string;
  readonly radiusM: number;
  readonly groundColor: number;
  readonly boulderColor: number;
}

export const MOON_PATCH: PatchStyle = {
  key: 'moon',
  radiusM: MOON_RADIUS_M,
  groundColor: 0xd9d6cf,
  boulderColor: 0x9a968e,
};

export class TerrainPatch {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly boulders: THREE.InstancedMesh;
  private readonly aim: THREE.Mesh;
  private readonly target: THREE.Mesh;
  /** Terrain height at the target (the patch origin). */
  readonly baseH: number;

  constructor(
    readonly terrain: SiteTerrain<TerrainSite>,
    cache: ResourceCache,
    private readonly style: PatchStyle = MOON_PATCH,
  ) {
    this.baseH = terrain.heightAt(0);
    this.geometry = this.buildGround();
    const mat = cache.material(
      `${style.key}:ground`,
      () =>
        new THREE.MeshStandardMaterial({
          map: (() => {
            const t = cache.texture('moon:regolith', () => createRegolithTexture());
            return t;
          })(),
          color: style.groundColor,
          roughness: 0.97,
          metalness: 0,
        }),
    );
    const ground = new THREE.Mesh(this.geometry, mat);
    ground.receiveShadow = false;
    this.group.add(ground);
    this.boulders = this.buildBoulders(cache);
    this.group.add(this.boulders);
    const ringMat = (key: string, color: number) =>
      cache.material(
        key,
        () =>
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      );
    const ring = cache.geometry('moon:ring', () =>
      new THREE.RingGeometry(9, 11, 48).rotateX(-Math.PI / 2),
    );
    this.target = new THREE.Mesh(ring, ringMat('moon:targetRing', 0xffd23f));
    this.target.position.set(0, this.localY(0, 0) + 0.4, 0);
    this.aim = new THREE.Mesh(ring, ringMat('moon:aimRing', 0x4fd1ff));
    this.aim.scale.setScalar(0.7);
    this.group.add(this.target, this.aim);
  }

  /** Local height (patch frame) of the ground at (x, z), with the Moon's curvature. */
  localY(x: number, z: number): number {
    return this.terrain.heightAt(x, z) - this.baseH - (x * x + z * z) / (2 * this.style.radiusM);
  }

  private buildGround(): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(HALF_X * 2, HALF_Z * 2, SEG_X, SEG_Z).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Skirt: sink toward the edges so the patch blends into the (lowered) sphere.
      const ex = Math.max(0, (Math.abs(x) - (HALF_X - 1_500)) / 1_500);
      const ez = Math.max(0, (Math.abs(z) - (HALF_Z - 1_000)) / 1_000);
      const edge = Math.min(1, Math.max(ex, ez));
      pos.setY(i, this.localY(x, z) * (1 - edge) - edge * (SPHERE_SINK_M + 50));
      uv.setXY(i, x / 60, z / 60);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildBoulders(cache: ResourceCache): THREE.InstancedMesh {
    const spots: { x: number; z: number; size: number }[] = [];
    for (let x = -900; x <= 900; x += 8) {
      for (let z = -400; z <= 400; z += 8) {
        const size = this.terrain.boulderAt(x + 4, z + 4);
        if (size > 0) spots.push({ x: x + 4, z: z + 4, size });
      }
    }
    const mesh = new THREE.InstancedMesh(
      cache.geometry('moon:boulder', () => new THREE.IcosahedronGeometry(1, 1)),
      cache.material(
        `${this.style.key}:boulderMat`,
        () =>
          new THREE.MeshStandardMaterial({
            color: this.style.boulderColor,
            roughness: 1,
            flatShading: true,
          }),
      ),
      Math.max(1, spots.length),
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    spots.forEach((b, i) => {
      e.set(b.x * 0.1, b.z * 0.13, b.size);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(b.x, this.localY(b.x, b.z) + b.size * 0.25, b.z),
        q,
        new THREE.Vector3(b.size * 0.9, b.size * 0.6, b.size * 0.8),
      );
      mesh.setMatrixAt(i, m);
    });
    mesh.count = spots.length;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /** Moves the assist's aim ring (along-track offset from the target), or hides it. */
  setAim(x: number | null): void {
    this.aim.visible = x !== null && Math.abs(x) > 1;
    if (x !== null) this.aim.position.set(x, this.localY(x, 0) + 0.5, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    this.boulders.dispose();
  }
}
