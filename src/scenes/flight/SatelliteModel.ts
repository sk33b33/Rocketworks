import * as THREE from 'three';
import type { ResourceCache } from '../../render/ResourceCache';

/*
 * A released contract satellite: original procedural geometry (a foil-wrapped bus, two solar
 * wings and a dish), a few metres across. Shared geometries and materials come from the scene's
 * resource cache, which disposes them with the scene.
 */
export class SatelliteModel {
  readonly root = new THREE.Group();

  constructor(cache: ResourceCache) {
    const bus = new THREE.Mesh(
      cache.geometry('sat:bus', () => new THREE.BoxGeometry(2.4, 2.4, 3.2)),
      cache.material(
        'sat:foil',
        () => new THREE.MeshStandardMaterial({ color: 0xc9a23a, metalness: 0.8, roughness: 0.35 }),
      ),
    );
    const panelGeo = cache.geometry('sat:panel', () => new THREE.BoxGeometry(7, 0.08, 2.2));
    const panelMat = cache.material(
      'sat:panel',
      () => new THREE.MeshStandardMaterial({ color: 0x1d3466, metalness: 0.3, roughness: 0.5 }),
    );
    const left = new THREE.Mesh(panelGeo, panelMat);
    left.position.set(-4.9, 0, 0);
    const right = new THREE.Mesh(panelGeo, panelMat);
    right.position.set(4.9, 0, 0);
    const dish = new THREE.Mesh(
      cache.geometry('sat:dish', () => new THREE.ConeGeometry(1.1, 0.6, 20, 1, true)),
      cache.material(
        'sat:dish',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xe6e6e6,
            roughness: 0.6,
            side: THREE.DoubleSide,
          }),
      ),
    );
    dish.position.set(0, 0, 2.0);
    dish.rotation.x = -Math.PI / 2;
    this.root.add(bus, left, right, dish);
    this.root.visible = false;
  }

  /**
   * Places the satellite relative to the ship (floating origin), slowly turning. Far away it is
   * drawn larger than life (a visual aid, not to scale) so it stays visible as it drifts off.
   */
  place(dx: number, dy: number, time: number): void {
    this.root.position.set(dx, dy, 0);
    this.root.rotation.set(0.3, time * 0.05, 0);
    this.root.scale.setScalar(Math.max(1, Math.hypot(dx, dy) / 300));
  }
}
