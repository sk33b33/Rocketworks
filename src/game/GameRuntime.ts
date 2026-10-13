import * as THREE from 'three';
import type { LocationId } from '../app/locations';
import type { SceneFactories } from './GameScene';
import { RenderLoop } from './RenderLoop';
import { SceneManager } from './SceneManager';

export interface RuntimeCallbacks {
  onFirstFrame: () => void;
  onContextLost: () => void;
}

/** Owns the single long-lived renderer, render loop, resize handling and scene manager. */
export class GameRuntime {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scenes: SceneManager;
  private readonly loop: RenderLoop;
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;
  private framesRendered = 0;

  constructor(
    private readonly container: HTMLElement,
    factories: SceneFactories,
    private readonly callbacks: RuntimeCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scenes = new SceneManager(
      { renderer: this.renderer, canvas: this.renderer.domElement },
      factories,
    );
    this.loop = new RenderLoop((dt) => this.frame(dt));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  start(): void {
    this.loop.start();
  }

  setLocation(id: LocationId): boolean {
    return this.scenes.switchTo(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.scenes.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(deltaSeconds: number): void {
    this.scenes.update(deltaSeconds);
    const active = this.scenes.activeScene;
    if (!active) return;
    this.renderer.render(active.scene, active.camera);
    if (this.framesRendered++ === 0) this.callbacks.onFirstFrame();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.scenes.resize(width, height);
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.loop.stop();
    this.callbacks.onContextLost();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.loop.stop();
    else if (!this.disposed) this.loop.start();
  };
}
