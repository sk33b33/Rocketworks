import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HALL } from './AssemblyHall';

/** Default viewing direction (from target toward camera): front-right, slightly raised. */
const DEFAULT_DIRECTION = new THREE.Vector3(0.78, 0.24, 0.58).normalize();
const TWEEN_SECONDS = 0.7;
const TARGET_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-40, 2, -40),
  new THREE.Vector3(40, 100, 40),
);

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Orbit camera with sensible limits, smooth framing of boxes (reset / focus), and keyboard control
 * when the canvas has focus: arrows orbit, +/- zoom, Shift+arrows pan.
 */
export class FactoryCamera {
  readonly controls: OrbitControls;
  private tween: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  } | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 6;
    c.maxDistance = 170;
    c.minPolarAngle = 0.08;
    c.maxPolarAngle = Math.PI * 0.495;
    c.screenSpacePanning = true;
    c.zoomSpeed = 0.9;
    this.controls = c;
    dom.addEventListener('keydown', this.onKeyDown);
  }

  /** Frames a box, keeping the current view direction unless `resetDirection` is set. */
  frame(box: THREE.Box3, options: { immediate?: boolean; resetDirection?: boolean } = {}): void {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitHeight = size.y / 2 / Math.tan(vFov / 2);
    const fitWidth = Math.max(size.x, size.z) / 2 / Math.tan(hFov / 2);
    const distance = THREE.MathUtils.clamp(
      Math.max(fitHeight, fitWidth, 4) * 1.22 + Math.max(size.x, size.z) / 2,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    const direction = options.resetDirection
      ? DEFAULT_DIRECTION.clone()
      : this.camera.position.clone().sub(this.controls.target).normalize();
    const toTarget = center.clamp(TARGET_BOUNDS.min, TARGET_BOUNDS.max);
    const toPos = toTarget.clone().addScaledVector(direction, distance);
    toPos.y = Math.max(toPos.y, 1.5);
    if (options.immediate) {
      this.tween = null;
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.controls.update();
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos,
      toTarget,
      t: 0,
    };
  }

  update(deltaSeconds: number): void {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + deltaSeconds / TWEEN_SECONDS);
      const k = ease(tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.target.clamp(TARGET_BOUNDS.min, TARGET_BOUNDS.max);
    this.controls.update();
    // Keep the camera inside the hall.
    const p = this.camera.position;
    p.x = THREE.MathUtils.clamp(p.x, -HALL.width / 2 + 3, HALL.width / 2 - 3);
    p.z = THREE.MathUtils.clamp(p.z, -HALL.depth / 2 + 6, HALL.depth / 2 - 3);
    p.y = THREE.MathUtils.clamp(p.y, 1.2, HALL.height - 12);
  }

  /** Disables mouse/touch/keyboard input while the scene is not the active location. */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
    this.enabled = enabled;
  }

  dispose(): void {
    this.dom.removeEventListener('keydown', this.onKeyDown);
    this.controls.dispose();
  }

  private enabled = true;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const step = 0.08;
    let handled = true;
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3(0, 1, 0);
      const amount = spherical.radius * 0.04;
      const delta = new THREE.Vector3();
      if (event.key === 'ArrowLeft') delta.addScaledVector(right, -amount);
      if (event.key === 'ArrowRight') delta.addScaledVector(right, amount);
      if (event.key === 'ArrowUp') delta.addScaledVector(up, amount);
      if (event.key === 'ArrowDown') delta.addScaledVector(up, -amount);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    } else {
      switch (event.key) {
        case 'ArrowLeft':
          spherical.theta -= step;
          break;
        case 'ArrowRight':
          spherical.theta += step;
          break;
        case 'ArrowUp':
          spherical.phi = Math.max(this.controls.minPolarAngle, spherical.phi - step);
          break;
        case 'ArrowDown':
          spherical.phi = Math.min(this.controls.maxPolarAngle, spherical.phi + step);
          break;
        case '+':
        case '=':
          spherical.radius = Math.max(this.controls.minDistance, spherical.radius * 0.9);
          break;
        case '-':
        case '_':
          spherical.radius = Math.min(this.controls.maxDistance, spherical.radius * 1.1);
          break;
        default:
          handled = false;
      }
      if (handled)
        this.camera.position
          .copy(this.controls.target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
    }
    if (handled) {
      this.tween = null;
      event.preventDefault();
    }
  };
}
