import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameScene, SceneContext } from '../../game/GameScene';
import type { LaunchSnapshot } from '../../launch/launchRuntime';
import { findPart } from '../../rocket/catalog/parts';
import { instanceStages } from '../../rocket/stats/calculateRocketStats';
import { BlueprintRenderer } from '../../render/rocket/BlueprintRenderer';
import { ResourceCache } from '../../render/ResourceCache';
import type { AscentState } from '../../simulation/ascent/ascentModel';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { createPlume, Fireball, LaunchSmoke, updatePlume, type Plume } from './Effects';
import {
  buildSpaceBackdrop,
  placeOnEarth,
  skyColor,
  vehicleRoll,
  type SpaceBackdrop,
} from './flightView';
import type { LaunchPadController, PadCameraMode } from './launchPadController';
import {
  buildLaunchSite,
  DECK_HEIGHT_M,
  MOUNT_TOP_M,
  ROLLOUT_START_X_M,
  type LaunchSite,
} from './LaunchSite';

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const STACK_CENTRE_M = 40;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

interface PlumeRef {
  readonly plume: Plume;
  readonly stage: 'booster' | 'ship';
  readonly seed: number;
}

/** Launch Pad: rollout, countdown and ascent of the committed vehicle, with three camera modes. */
export class LaunchPadScene implements GameScene {
  readonly id = 'launch-pad' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 120_000);

  private readonly cache = new ResourceCache();
  private readonly rocket = new BlueprintRenderer(this.cache);
  private site: LaunchSite | null = null;
  private space: SpaceBackdrop | null = null;
  private smoke: LaunchSmoke | null = null;
  private fireball: Fireball | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private unsubscribers: (() => void)[] = [];

  private builtFor: string | null = null;
  private plumes: PlumeRef[] = [];
  private shipNode: THREE.Object3D | null = null;
  private shipDetached = false;
  private shipOffsetM = 0;
  private boosterSpin = 0;
  private exploded = false;
  private smokeStarted = false;
  private time = 0;

  // Camera orbit parameters (pad/follow modes), adjustable by dragging and the wheel.
  private yaw = -0.55;
  private pitch = 0.12;
  private zoom = 1;
  private drag: { x: number; y: number } | null = null;
  private readonly focus = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly sky = new THREE.Color();

  constructor(private readonly controller: LaunchPadController) {}

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    // Reflection environment so the stainless steel reads as metal outdoors.
    const pmrem = new THREE.PMREMGenerator(context.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1.1;
    this.scene.fog = new THREE.Fog(0x8cbbe6, 3_000, 40_000);
    this.scene.background = new THREE.Color(0x8cbbe6);
    this.site = buildLaunchSite(this.scene, this.cache);
    this.space = buildSpaceBackdrop(this.scene, this.cache);
    this.smoke = new LaunchSmoke(this.cache);
    this.fireball = new Fireball(this.cache);
    this.scene.add(this.rocket.root, this.smoke.group, this.fireball.group);
  }

  enter(): void {
    this.controller.onEnter();
    const canvas = this.canvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
    }
    this.unsubscribers.push(this.controller.subscribeCameraReset(() => this.resetView()));
  }

  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    // The scene drives the launch runtime only while the pad is the active location.
    this.controller.runtime.update(deltaSeconds);
    const snap = this.controller.runtime.current;
    const live = this.controller.runtime.liveAscent;
    this.syncRocket(snap);
    this.placeVehicle(snap, live);
    this.smoke?.update(deltaSeconds);
    this.fireball?.update(deltaSeconds);
    this.updateCamera(snap, live);
    this.updateEnvironment();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.drag = null;
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  dispose(): void {
    this.exit();
    this.clearRocket();
    this.smoke?.clear();
    this.fireball?.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.cache.dispose();
    this.envTarget?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  // ---------- rocket ----------

  private clearRocket(): void {
    if (this.shipNode && this.shipDetached) this.shipNode.removeFromParent();
    this.rocket.clear();
    this.plumes = [];
    this.shipNode = null;
    this.shipDetached = false;
  }

  /** Rebuilds the vehicle whenever a new launch context appears. */
  private syncRocket(snap: LaunchSnapshot): void {
    const key = snap.context ? `${snap.context.outcome.id}:${snap.context.designRevision}` : null;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.clearRocket();
    this.exploded = false;
    this.smokeStarted = false;
    this.boosterSpin = 0;
    this.smoke?.clear();
    this.rocket.root.visible = !!snap.context;
    if (!snap.context) return;
    const bp = snap.context.blueprint;
    this.rocket.build(bp);
    const stages = instanceStages(bp);
    for (const inst of bp.parts) {
      const part = findPart(inst.partId);
      if (!part?.thrustN) continue;
      const node = this.rocket.getInstanceNode(inst.id);
      if (!node) continue;
      const plume = createPlume(this.cache);
      node.add(plume.root);
      this.plumes.push({
        plume,
        stage: stages.get(inst.id) ?? 'booster',
        seed: this.plumes.length,
      });
    }
    const shipAft = bp.parts.find((p) => p.partId === 'ship-aft-section');
    this.shipNode = shipAft ? (this.rocket.getInstanceNode(shipAft.id) ?? null) : null;
  }

  private setPlumes(
    stage: 'booster' | 'ship',
    on: boolean,
    throttle: number,
    altitudeM: number,
  ): void {
    for (const p of this.plumes) {
      if (p.stage === stage) updatePlume(p.plume, on, throttle, altitudeM, this.time, p.seed);
    }
  }

  private placeVehicle(snap: LaunchSnapshot, live: AscentState | null): void {
    const site = this.site;
    if (!site) return;
    const root = this.rocket.root;
    const parked = () => {
      site.transporter.position.set(-95, 0, 45);
      site.transporter.rotation.y = 0.6;
    };

    if (!snap.context) {
      parked();
      return;
    }
    switch (snap.phase) {
      case 'rollout': {
        const p = snap.rolloutProgress;
        const drive = ease(clamp01(p / 0.7));
        const lift = ease(clamp01((p - 0.7) / 0.25));
        const back = ease(clamp01((p - 0.95) / 0.05));
        const x = ROLLOUT_START_X_M * (1 - drive);
        root.position.set(x, DECK_HEIGHT_M + (MOUNT_TOP_M - DECK_HEIGHT_M) * lift, 0);
        root.rotation.set(0, 0, 0);
        site.transporter.position.set(x - 60 * back, 0, 0);
        site.transporter.rotation.y = 0;
        site.catchArms.position.y = 60 + root.position.y;
        this.setPlumes('booster', false, 0, 0);
        this.setPlumes('ship', false, 0, 0);
        return;
      }
      case 'pad':
      case 'countdown':
      case 'idle':
        root.position.set(0, MOUNT_TOP_M, 0);
        root.rotation.set(0, 0, 0);
        parked();
        site.catchArms.position.y = 60 + MOUNT_TOP_M;
        this.placePrelaunch(snap);
        return;
      default:
        break;
    }
    if (!live) {
      // Debrief after a scrub: the vehicle is still on the mount.
      root.position.set(0, MOUNT_TOP_M, 0);
      root.rotation.set(0, 0, 0);
      this.setPlumes('booster', false, 0, 0);
      parked();
      return;
    }
    parked();
    site.qdArm.rotation.y = -1.3;
    this.placeInFlight(live);
  }

  private placePrelaunch(snap: LaunchSnapshot): void {
    const site = this.site!;
    const clock = snap.phase === 'countdown' ? snap.clockS : -9999;
    site.qdArm.rotation.y = -1.3 * clamp01((clock + 120) / 20);
    const ignition = snap.phase === 'countdown' && clock >= -3;
    if (ignition && !this.smokeStarted) {
      this.smokeStarted = true;
      this.smoke?.start();
    }
    this.setPlumes('booster', ignition, ignition ? 0.3 + 0.7 * clamp01((clock + 3) / 3) : 0, 0);
    this.setPlumes('ship', false, 0, 0);
  }

  private placeInFlight(s: AscentState): void {
    const root = this.rocket.root;
    const main = placeOnEarth(s.downrangeM, s.altitudeM + MOUNT_TOP_M);
    const roll = vehicleRoll(s.elevationDeg, main.arcRad);

    if (s.stage === 'ship' && this.shipNode && !this.shipDetached) {
      // Hot staging: detach the ship (keeping its world transform) and remember its offset.
      this.shipNode.updateWorldMatrix(true, false);
      root.updateWorldMatrix(true, false);
      const shipPos = this.shipNode.getWorldPosition(new THREE.Vector3());
      const rootPos = root.getWorldPosition(new THREE.Vector3());
      const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(Z_AXIS, root.rotation.z);
      this.shipOffsetM = shipPos.sub(rootPos).dot(axis);
      this.scene.attach(this.shipNode);
      this.shipDetached = true;
    }

    const lost = s.status === 'lost';
    if (lost && !this.exploded) {
      this.exploded = true;
      const at =
        this.shipDetached && this.shipNode
          ? this.shipNode.position.clone()
          : root.position.clone().add(new THREE.Vector3(0, STACK_CENTRE_M, 0));
      this.fireball?.trigger(at);
    }

    if (!this.shipDetached) {
      root.position.set(main.x, main.y, 0);
      root.rotation.set(0, 0, roll);
      root.visible = !lost;
      this.setPlumes('booster', s.enginesOn, s.throttle, s.altitudeM);
      this.setPlumes('ship', false, 0, 0);
      return;
    }

    // Ship flies the main trajectory; the booster follows its own ballistic path.
    const ship = this.shipNode!;
    const axis = new THREE.Vector3(0, 1, 0).applyAxisAngle(Z_AXIS, roll);
    ship.position.set(main.x, main.y, 0).addScaledVector(axis, this.shipOffsetM);
    ship.rotation.set(0, 0, roll);
    ship.visible = !lost;
    this.setPlumes('ship', s.enginesOn, s.throttle, s.altitudeM);

    const b = s.booster;
    if (b && !b.landed) {
      const bp = placeOnEarth(b.downrangeM, b.altitudeM + MOUNT_TOP_M);
      this.boosterSpin += 0.004;
      root.position.set(bp.x, bp.y, 0);
      root.rotation.set(
        0,
        0,
        vehicleRoll(s.elevationDeg, bp.arcRad) + Math.min(Math.PI, this.boosterSpin),
      );
      root.visible = true;
    } else {
      root.visible = false;
    }
    this.setPlumes('booster', false, 0, 0);
  }

  // ---------- camera ----------

  private vehicleFocus(
    snap: LaunchSnapshot,
    live: AscentState | null,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const node = this.shipDetached && this.shipNode ? this.shipNode : this.rocket.root;
    node.getWorldPosition(out);
    const offset = this.shipDetached ? 10 : STACK_CENTRE_M;
    const roll = this.shipDetached ? node.rotation.z : this.rocket.root.rotation.z;
    out.addScaledVector(this.tmp.set(0, 1, 0).applyAxisAngle(Z_AXIS, roll), offset);
    if (!snap.context) out.set(0, MOUNT_TOP_M + 20, 0);
    void live;
    return out;
  }

  private updateCamera(snap: LaunchSnapshot, live: AscentState | null): void {
    const mode: PadCameraMode = this.controller.getCameraMode();
    const target = this.vehicleFocus(snap, live, this.focus);
    const cam = this.camera;
    const flying = snap.phase === 'ascent' || (snap.phase === 'debrief' && !!live);

    if (mode === 'follow') {
      const dist = 190 * this.zoom;
      const dir = new THREE.Vector3(
        Math.cos(this.pitch) * Math.sin(this.yaw),
        Math.sin(this.pitch),
        Math.cos(this.pitch) * Math.cos(this.yaw),
      );
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.fov = 50;
    } else if (mode === 'cinematic') {
      const shot = Math.floor(this.time / 9) % 3;
      if (!flying) {
        const a = this.time * 0.05;
        cam.position.set(Math.sin(a) * 340, 70 + Math.sin(this.time * 0.1) * 20, Math.cos(a) * 340);
      } else if (shot === 0) {
        cam.position.set(260, 8, 420);
      } else if (shot === 1) {
        cam.position.set(2_600, 25, -1_900);
      } else {
        const roll = (this.shipDetached && this.shipNode ? this.shipNode : this.rocket.root)
          .rotation.z;
        const axis = this.tmp.set(0, 1, 0).applyAxisAngle(Z_AXIS, roll);
        cam.position
          .copy(target)
          .addScaledVector(axis, -140)
          .add(new THREE.Vector3(0, 0, 60));
      }
      const d = cam.position.distanceTo(target);
      cam.fov = THREE.MathUtils.clamp((2 * Math.atan(110 / d) * 180) / Math.PI, 0.6, 55);
    } else {
      // Pad overview: a fixed site camera that pans and zooms to keep the vehicle in frame.
      const base = new THREE.Vector3(
        Math.sin(this.yaw) * 520,
        45 + this.pitch * 300,
        Math.cos(this.yaw) * 520,
      ).multiplyScalar(this.zoom);
      cam.position.copy(base);
      const d = cam.position.distanceTo(target);
      cam.fov = THREE.MathUtils.clamp((2 * Math.atan(130 / d) * 180) / Math.PI, 0.6, 50);
    }
    cam.lookAt(target);
    const dist = cam.position.distanceTo(target);
    const camAlt =
      cam.position.distanceTo(new THREE.Vector3(0, -EARTH_RADIUS_M, 0)) - EARTH_RADIUS_M;
    cam.near = THREE.MathUtils.clamp(dist * 0.02, 0.3, 150);
    cam.far = camAlt > 4_000 || dist > 20_000 ? 2.6e7 : 120_000;
    cam.updateProjectionMatrix();
  }

  private updateEnvironment(): void {
    const camAlt =
      this.camera.position.distanceTo(new THREE.Vector3(0, -EARTH_RADIUS_M, 0)) - EARTH_RADIUS_M;
    skyColor(camAlt, this.sky);
    (this.scene.background as THREE.Color).copy(this.sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky);
    fog.near = 3_000 + camAlt * 2;
    fog.far = camAlt > 40_000 ? 1e9 : 40_000 + camAlt * 40;
    if (this.space) {
      const high = camAlt > 1_500;
      this.space.earth.visible = high;
      this.space.atmosphere.visible = high;
      this.space.stars.position.copy(this.camera.position);
      (this.space.stars.material as THREE.PointsMaterial).opacity = clamp01(
        (camAlt - 25_000) / 30_000,
      );
    }
    if (this.site) this.site.sun.castShadow = camAlt < 3_000;
  }

  resetView(): void {
    this.yaw = -0.55;
    this.pitch = 0.12;
    this.zoom = 1;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onPointerUp = (): void => {
    this.drag = null;
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    this.yaw -= (e.clientX - this.drag.x) * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -0.2, 1.2);
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.25, 4);
  };
}
