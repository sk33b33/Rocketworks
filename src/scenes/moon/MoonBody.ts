import * as THREE from 'three';
import { MOON_RADIUS_M } from '../../moon/moonOrbit';
import { LUNAR_SITES, type SiteTerrain } from '../../moon/lunarSites';
import type { ResourceCache } from '../../render/ResourceCache';
import { createMoonTexture } from './moonTextures';
import { SPHERE_SINK_M, TerrainPatch } from './TerrainPatch';

/*
 * The Moon: a textured sphere that turns with its synchronous rotation, small markers at the
 * landing sites, and (near the chosen site) the high-detail terrain patch. `group` sits at the
 * Moon's centre in scene space; everything inside it uses the Moon's own frame, where the
 * selenographic angle of a direction is atan2(x, y) and 0 faces Earth.
 */

export class MoonBody {
  readonly group = new THREE.Group();
  readonly sphere: THREE.Mesh;
  private patch: TerrainPatch | null = null;
  private readonly markers: THREE.Mesh[] = [];

  constructor(private readonly cache: ResourceCache) {
    const tex = cache.texture('moon:surface', () => createMoonTexture());
    this.sphere = new THREE.Mesh(
      cache.geometry('moon:sphere', () =>
        new THREE.SphereGeometry(MOON_RADIUS_M, 160, 80).rotateX(Math.PI / 2),
      ),
      cache.material(
        'moon:sphereMat',
        () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }),
      ),
    );
    this.group.add(this.sphere);
    const dot = cache.geometry('moon:siteDot', () => new THREE.SphereGeometry(1, 12, 8));
    for (const site of LUNAR_SITES) {
      const m = new THREE.Mesh(
        dot,
        cache.material(
          `moon:siteMat:${site.hazard}`,
          () =>
            new THREE.MeshBasicMaterial({
              color:
                site.hazard === 'low' ? 0x6be38a : site.hazard === 'moderate' ? 0xffd23f : 0xff7a59,
            }),
        ),
      );
      m.position.set(Math.sin(site.seleno), Math.cos(site.seleno), 0).multiplyScalar(MOON_RADIUS_M);
      m.userData.siteId = site.id;
      this.markers.push(m);
      this.group.add(m);
    }
  }

  /** Builds (or swaps) the terrain patch for the chosen site. */
  setSite(terrain: SiteTerrain): void {
    if (this.patch?.terrain === terrain) return;
    if (this.patch) {
      this.group.remove(this.patch.group);
      this.patch.dispose();
    }
    this.patch = new TerrainPatch(terrain, this.cache);
    const a = terrain.site.seleno;
    const up = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
    const east = new THREE.Vector3(Math.cos(a), -Math.sin(a), 0);
    const basis = new THREE.Matrix4().makeBasis(east, up, new THREE.Vector3(0, 0, 1));
    this.patch.group.quaternion.setFromRotationMatrix(basis);
    this.patch.group.position.copy(up).multiplyScalar(MOON_RADIUS_M + this.patch.baseH);
    this.group.add(this.patch.group);
  }

  get terrainPatch(): TerrainPatch | null {
    return this.patch;
  }

  /**
   * Places the Moon (centre in scene space), turns it so selenographic 0 faces Earth, and shows
   * the terrain patch when the camera is close. `markerScale` sizes the site markers (0 hides).
   */
  update(
    centre: THREE.Vector3,
    toEarthAngle: number,
    showPatch: boolean,
    markerScale: number,
  ): void {
    this.group.position.copy(centre);
    this.group.rotation.set(0, 0, -toEarthAngle);
    const patch = !!this.patch && showPatch;
    if (this.patch) this.patch.group.visible = patch;
    this.sphere.scale.setScalar(patch ? (MOON_RADIUS_M - SPHERE_SINK_M) / MOON_RADIUS_M : 1);
    this.group.updateMatrixWorld(true);
    this.setMarkers(markerScale);
  }

  /** Sizes the site markers (0 hides them). */
  setMarkers(markerScale: number): void {
    for (const m of this.markers) {
      m.visible = markerScale > 0;
      m.scale.setScalar(markerScale);
    }
  }

  dispose(): void {
    this.patch?.dispose();
    this.patch = null;
  }
}
