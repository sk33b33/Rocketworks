import * as THREE from 'three';
import type { SiteTerrain } from '../../moon/lunarSites';
import type { MarsSite } from '../../mars/marsSites';
import { MARS_RADIUS_M } from '../../mars/solarSystem';
import type { ResourceCache } from '../../render/ResourceCache';
import { SPHERE_SINK_M, TerrainPatch, type PatchStyle } from '../moon/TerrainPatch';
import { createMarsTexture } from './marsTextures';

/*
 * Mars: a textured sphere (Mars's rotation isn't simulated, so it doesn't turn), a thin haze
 * shell for the atmosphere, and — once the approach has fixed where the site lies — the
 * high-detail terrain patch around the landing target. `group` sits at Mars's centre in scene
 * space, in the Mars-centred frame of the physics (angle = atan2(x, y)).
 */

const MARS_PATCH: PatchStyle = {
  key: 'mars',
  radiusM: MARS_RADIUS_M,
  groundColor: 0xc98a62,
  boulderColor: 0x7d4a33,
};

export class MarsBody {
  readonly group = new THREE.Group();
  readonly sphere: THREE.Mesh;
  private readonly haze: THREE.Mesh;
  private patch: TerrainPatch | null = null;
  private patchKey = '';
  private elevationM = 0;

  constructor(private readonly cache: ResourceCache) {
    const tex = cache.texture('mars:surface', () => createMarsTexture());
    this.sphere = new THREE.Mesh(
      cache.geometry('mars:sphere', () =>
        new THREE.SphereGeometry(MARS_RADIUS_M, 160, 80).rotateX(Math.PI / 2),
      ),
      cache.material(
        'mars:sphereMat',
        () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }),
      ),
    );
    this.haze = new THREE.Mesh(
      cache.geometry('mars:haze', () =>
        new THREE.SphereGeometry(MARS_RADIUS_M + 60_000, 96, 48).rotateX(Math.PI / 2),
      ),
      cache.material(
        'mars:hazeMat',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0xe0a070,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide,
            depthWrite: false,
          }),
      ),
    );
    this.group.add(this.sphere, this.haze);
  }

  /** Builds (or moves) the terrain patch for the site at its fixed angle. */
  setSite(terrain: SiteTerrain<MarsSite>, angle: number): void {
    const key = `${terrain.site.id}:${angle}`;
    if (this.patchKey === key) return;
    if (this.patch) {
      this.group.remove(this.patch.group);
      this.patch.dispose();
    }
    this.patchKey = key;
    this.elevationM = terrain.site.elevationM;
    this.patch = new TerrainPatch(terrain, this.cache, MARS_PATCH);
    const up = new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);
    const east = new THREE.Vector3(Math.cos(angle), -Math.sin(angle), 0);
    const basis = new THREE.Matrix4().makeBasis(east, up, new THREE.Vector3(0, 0, 1));
    this.patch.group.quaternion.setFromRotationMatrix(basis);
    this.patch.group.position
      .copy(up)
      .multiplyScalar(MARS_RADIUS_M + this.elevationM + this.patch.baseH);
    this.group.add(this.patch.group);
  }

  get terrainPatch(): TerrainPatch | null {
    return this.patch;
  }

  /** Places Mars (centre in scene space) and shows the patch when close to it. */
  update(centre: THREE.Vector3, showPatch: boolean): void {
    this.group.position.copy(centre);
    const patch = !!this.patch && showPatch;
    if (this.patch) this.patch.group.visible = patch;
    // With the patch shown, lower the sphere below the site so it doesn't poke through.
    const r = patch ? MARS_RADIUS_M + this.elevationM - SPHERE_SINK_M : MARS_RADIUS_M;
    this.sphere.scale.setScalar(r / MARS_RADIUS_M);
    this.haze.visible = !patch;
    this.group.updateMatrixWorld(true);
  }

  dispose(): void {
    this.patch?.dispose();
    this.patch = null;
    this.patchKey = '';
  }
}
