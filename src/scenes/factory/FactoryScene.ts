import * as THREE from 'three';
import type { GameScene } from '../../game/GameScene';

/**
 * TEMPORARY Stage 0 scaffold: an empty floor with a turntable-style slow camera drift so the
 * renderer, resize and lifecycle can be verified. The real assembly hall arrives in Stage 1.
 */
export class FactoryScene implements GameScene {
  readonly id = 'factory' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  private elapsed = 0;
  private readonly disposables: { dispose(): void }[] = [];

  create(): void {
    this.scene.background = new THREE.Color(0x0b0f14);
    this.scene.fog = new THREE.Fog(0x0b0f14, 30, 120);

    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.85 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 40, 0xe0a030, 0x3a424c);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Placeholder marker showing where the rocket will be assembled.
    const markerGeo = new THREE.CylinderGeometry(4, 4, 0.2, 48);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0x59636f,
      metalness: 0.6,
      roughness: 0.4,
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.y = 0.1;
    this.scene.add(marker);

    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(12, 25, 10);
    this.scene.add(key, new THREE.HemisphereLight(0x9fb4cc, 0x20242a, 0.6));

    this.disposables.push(floorGeo, floorMat, markerGeo, markerMat, grid.geometry);
    this.disposables.push(grid.material as THREE.Material);
    this.placeCamera();
  }

  enter(): void {
    this.elapsed = 0;
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.placeCamera();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {}

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.scene.clear();
  }

  private placeCamera(): void {
    const angle = this.elapsed * 0.15;
    this.camera.position.set(Math.sin(angle) * 22, 9, Math.cos(angle) * 22);
    this.camera.lookAt(0, 4, 0);
  }
}
