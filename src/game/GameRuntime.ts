import * as THREE from 'three';
import type { LocationId } from '../app/locations';
import type { SceneFactories } from './GameScene';
import { RenderLoop } from './RenderLoop';
import { SceneManager } from './SceneManager';
import { PerfStats, perfProbe } from './PerfStats';
import { photoLocalPose, pivotDistance, type PhotoView } from './photoCamera';

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
  readonly stats = new PerfStats();
  /** Photo mode: its own camera riding along with the active scene's camera. */
  private photo: PhotoView | null = null;
  private pivotDist = 0;
  private readonly photoCamera = new THREE.PerspectiveCamera();
  private readonly photoPos = new THREE.Vector3();
  private readonly photoQuat = new THREE.Quaternion();

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    perfProbe.stats = this.stats;
  }

  start(): void {
    this.loop.start();
  }

  setLocation(id: LocationId): boolean {
    return this.scenes.switchTo(id);
  }

  /** Turns photo mode on (with the view to use) or off (null). */
  setPhoto(view: PhotoView | null): void {
    if (view && !this.photo) this.pivotDist = this.findPivot();
    this.photo = view;
  }

  /** Renders the current view now and returns it as a PNG data URL (null without a scene). */
  capture(): string | null {
    const active = this.scenes.activeScene;
    if (!active || this.disposed) return null;
    // The drawing buffer isn't preserved, so read it back in the same task as the render.
    this.renderer.render(active.scene, this.viewCamera(active.camera));
    try {
      return this.renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.scenes.dispose();
    if (perfProbe.stats === this.stats) perfProbe.stats = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(deltaSeconds: number): void {
    const t0 = performance.now();
    this.scenes.update(deltaSeconds);
    const active = this.scenes.activeScene;
    if (!active) return;
    const t1 = performance.now();
    this.renderer.render(active.scene, this.viewCamera(active.camera));
    this.stats.record(deltaSeconds, t1 - t0, performance.now() - t1, this.renderer.info, active.id);
    if (this.framesRendered++ === 0) this.callbacks.onFirstFrame();
  }

  /** The camera to render with: the scene's own, or the photo camera following it. */
  private viewCamera(sceneCamera: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
    if (!this.photo) return sceneCamera;
    const cam = this.photoCamera;
    sceneCamera.updateMatrixWorld();
    photoLocalPose(this.pivotDist, this.photo, this.photoPos, this.photoQuat);
    cam.position.copy(this.photoPos).applyMatrix4(sceneCamera.matrixWorld);
    cam.quaternion.copy(sceneCamera.quaternion).multiply(this.photoQuat);
    cam.fov = sceneCamera.fov;
    cam.aspect = sceneCamera.aspect;
    cam.near = Math.min(sceneCamera.near, Math.max(0.05, this.pivotDist * 0.01));
    cam.far = sceneCamera.far + this.pivotDist * (1 + this.photo.zoom);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
  }

  /** Distance to whatever solid surface is at the centre of the view (the photo pivot). */
  private findPivot(): number {
    const active = this.scenes.activeScene;
    if (!active) return pivotDistance(null);
    active.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), active.camera);
    const hit = ray
      .intersectObjects(active.scene.children, true)
      .find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
    return pivotDistance(hit ? hit.distance : null);
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
