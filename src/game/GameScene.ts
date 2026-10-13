import type * as THREE from 'three';
import type { LocationId } from '../app/locations';

/** Services shared by all scenes. The renderer is owned by GameRuntime, never by a scene. */
export interface SceneContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
}

/**
 * Scene lifecycle contract. A scene owns its geometries, materials, textures, controls and
 * listeners and must release all of them in dispose(). It must not touch game domain state.
 */
export interface GameScene {
  readonly id: LocationId;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  create(context: SceneContext): void;
  enter(previous: LocationId | null): void;
  update(deltaSeconds: number): void;
  resize(width: number, height: number): void;
  exit(next: LocationId | null): void;
  dispose(): void;
}

export type SceneFactory = () => GameScene;
export type SceneFactories = Partial<Record<LocationId, SceneFactory>>;
