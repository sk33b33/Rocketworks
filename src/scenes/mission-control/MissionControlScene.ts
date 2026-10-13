import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GameScene, SceneContext } from '../../game/GameScene';
import { ResourceCache } from '../../render/ResourceCache';
import { buildControlRoom, ROOM } from './ControlRoom';
import type { MissionControlController, MissionControlView } from './missionControlController';
import {
  drawConsoleScreen,
  drawMainDisplay,
  drawPollDisplay,
  drawWeatherDisplay,
} from './wallDisplays';

const DEFAULT_TARGET = new THREE.Vector3(0, 5.2, ROOM.frontZ);
const DEFAULT_POSITION = new THREE.Vector3(0, 6.2, ROOM.frontZ + 24);

type Painter = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: MissionControlView,
) => void;

interface CanvasScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  readonly paint: Painter;
}

/** Mission Control: a 3D control room whose wall screens show the live mission plan. */
export class MissionControlScene implements GameScene {
  readonly id = 'mission-control' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

  private readonly cache = new ResourceCache();
  private readonly screens: CanvasScreen[] = [];
  private controls: OrbitControls | null = null;
  private unsubscribers: (() => void)[] = [];
  private tween: { from: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null = null;

  constructor(private readonly controller: MissionControlController) {}

  create(context: SceneContext): void {
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.Fog(0x07090d, 30, 70);
    const main = this.makeScreen(1024, 448, drawMainDisplay);
    const left = this.makeScreen(512, 320, drawPollDisplay);
    const right = this.makeScreen(512, 320, drawWeatherDisplay);
    const consoleTex = this.makeStaticTexture(128, 80, drawConsoleScreen);
    const consoleMat = this.cache.material(
      'mc:consoleScreen',
      () => new THREE.MeshBasicMaterial({ map: consoleTex }),
    );
    const { group } = buildControlRoom(this.cache, {
      main: main.material,
      left: left.material,
      right: right.material,
      console: consoleMat,
    });
    this.scene.add(group);

    const controls = new OrbitControls(this.camera, context.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5;
    controls.maxDistance = 26;
    controls.minPolarAngle = 1.05;
    controls.maxPolarAngle = 1.62;
    controls.minAzimuthAngle = -0.7;
    controls.maxAzimuthAngle = 0.7;
    controls.enablePan = false;
    this.controls = controls;
    this.resetCamera(true);
  }

  enter(): void {
    if (this.controls) this.controls.enabled = true;
    this.repaint(this.controller.getView());
    this.unsubscribers.push(
      this.controller.subscribe((view) => this.repaint(view)),
      this.controller.subscribeCamera((req) => {
        if (req.kind === 'reset') this.resetCamera(false);
      }),
    );
  }

  update(deltaSeconds: number): void {
    if (this.tween && this.controls) {
      this.tween.t = Math.min(1, this.tween.t + deltaSeconds / 0.6);
      const k = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, DEFAULT_POSITION, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, DEFAULT_TARGET, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls?.update();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    // The scene stays cached while other locations are shown; detach input and subscriptions.
    if (this.controls) this.controls.enabled = false;
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  dispose(): void {
    this.exit();
    this.controls?.dispose();
    this.controls = null;
    this.scene.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const s of this.screens) {
      s.texture.dispose();
      s.material.dispose();
    }
    this.screens.length = 0;
    this.cache.dispose();
    this.scene.clear();
  }

  private makeScreen(w: number, h: number, paint: Painter): CanvasScreen {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const screen = { canvas, texture, material, paint };
    this.screens.push(screen);
    return screen;
  }

  private makeStaticTexture(
    w: number,
    h: number,
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ) {
    return this.cache.texture('mc:consoleTex', () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) paint(ctx, w, h);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });
  }

  private repaint(view: MissionControlView): void {
    for (const s of this.screens) {
      const ctx = s.canvas.getContext('2d');
      if (!ctx) continue;
      s.paint(ctx, s.canvas.width, s.canvas.height, view);
      s.texture.needsUpdate = true;
    }
  }

  private resetCamera(immediate: boolean): void {
    if (!this.controls) return;
    if (immediate) {
      this.camera.position.copy(DEFAULT_POSITION);
      this.controls.target.copy(DEFAULT_TARGET);
      this.controls.update();
      return;
    }
    this.tween = {
      from: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      t: 0,
    };
  }
}
