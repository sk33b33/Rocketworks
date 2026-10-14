import * as THREE from 'three';
import { autoMotion } from '../../render/motion';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameScene, SceneContext } from '../../game/GameScene';
import { shipOnlyBlueprint } from '../../flight/shipSpec';
import { findPart } from '../../rocket/catalog/parts';
import { BlueprintRenderer } from '../../render/rocket/BlueprintRenderer';
import { ResourceCache } from '../../render/ResourceCache';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { CORRIDOR_HALF_ANGLE_DEG, KEEP_OUT_M, PORT } from '../../station/proximity';
import { STATION_ALT_M, stationAngle } from '../../station/stationOrbit';
import { Planet } from '../flight/Planet';
import type { StationCameraMode, StationController } from './stationController';
import { lvlhToModel, StationModel } from './StationModel';

const SUN_DIR = new THREE.Vector3(0.55, 0.6, 0.58).normalize();
const DEG = Math.PI / 180;

/**
 * Orbital Station: proximity operations around the fictional station. The station sits at the
 * origin (floating origin), Earth below; the ship is placed from the proximity state.
 */
export class StationScene implements GameScene {
  readonly id = 'station' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3e7);

  private readonly cache = new ResourceCache();
  private station: StationModel | null = null;
  private planet: Planet | null = null;
  private readonly ship = new THREE.Group();
  private readonly shipInner = new THREE.Group();
  private readonly shipRenderer: BlueprintRenderer;
  private builtFor: string | null = null;
  private guides = new THREE.Group();
  private canvas: HTMLCanvasElement | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private unsubscribers: (() => void)[] = [];
  private time = 0;
  private yaw = 0.7;
  private pitch = 0.25;
  private zoom = 1;
  private drag: { x: number; y: number } | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly controller: StationController) {
    this.shipRenderer = new BlueprintRenderer(this.cache);
  }

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    const pmrem = new THREE.PMREMGenerator(context.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.5;
    this.scene.background = new THREE.Color(0x000000);
    const sun = new THREE.DirectionalLight(0xfff3e0, 3);
    sun.position.copy(SUN_DIR).multiplyScalar(500);
    this.scene.add(sun, sun.target, new THREE.HemisphereLight(0x8fb4ff, 0x0b0d12, 0.4));
    this.station = new StationModel(this.cache);
    this.planet = new Planet(this.cache);
    this.shipInner.add(this.shipRenderer.root);
    this.ship.add(this.shipInner);
    this.buildGuides();
    this.scene.add(this.station.root, this.planet.group, this.planet.stars, this.ship, this.guides);
  }

  private buildGuides(): void {
    // Keep-out sphere (faint wireframe) and the approach corridor cone from the port.
    const kos = new THREE.LineSegments(
      this.cache.geometry(
        'stn:kos',
        () => new THREE.WireframeGeometry(new THREE.SphereGeometry(KEEP_OUT_M, 24, 16)),
      ),
      this.cache.material(
        'stn:kosMat',
        () => new THREE.LineBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.12 }),
      ),
    );
    const len = KEEP_OUT_M + 60;
    const r = Math.tan(CORRIDOR_HALF_ANGLE_DEG * DEG) * len;
    const cone = new THREE.LineSegments(
      this.cache.geometry('stn:cone', () =>
        new THREE.WireframeGeometry(new THREE.ConeGeometry(r, len, 24, 1, true))
          .rotateZ(Math.PI / 2)
          .translate(PORT[1] + len / 2, 0, 0),
      ),
      this.cache.material(
        'stn:coneMat',
        () => new THREE.LineBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0.25 }),
      ),
    );
    this.guides.add(kos, cone);
  }

  enter(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
    }
    this.unsubscribers.push(this.controller.subscribeCameraReset(() => this.resetView()));
  }

  update(dt: number): void {
    this.time += dt;
    this.controller.runtime.update(dt);
    const snap = this.controller.runtime.current;
    const prox = this.controller.runtime.proximity;
    this.station?.update(this.time);
    // Earth below the station, turned so the station's local vertical is +Y.
    const eph = snap.station?.eph;
    const t = prox?.state.tS ?? snap.state?.tS ?? 0;
    const angle = eph ? stationAngle(eph, t) : 0;
    if (this.planet) {
      const centre = new THREE.Vector3(0, -(EARTH_RADIUS_M + STATION_ALT_M), 0);
      this.planet.update(centre, angle, STATION_ALT_M, STATION_ALT_M, SUN_DIR, snap.zone, null);
      this.planet.group.rotation.z = angle;
      this.planet.stars.visible = true;
    }
    this.ship.visible = !!prox && !!snap.context;
    if (prox && snap.context) {
      const key = `${snap.context.outcome.id}:${snap.context.designRevision}`;
      if (key !== this.builtFor) {
        this.builtFor = key;
        const ship = shipOnlyBlueprint(snap.context.blueprint);
        this.shipRenderer.build(ship);
        const len = ship.parts.reduce((s, p) => s + (findPart(p.partId)?.heightM ?? 0), 0);
        // The docking port (nose tip) is the ship's reference point.
        this.shipRenderer.root.position.set(0, -len, 0);
      }
      const s = prox.state;
      lvlhToModel(s.p, this.ship.position);
      // Nose toward the port (-X) with the pointing and roll errors applied.
      this.ship.rotation.set(0, 0, Math.PI / 2);
      this.shipInner.rotation.set(s.att.yaw * DEG, s.att.roll * DEG, s.att.pitch * DEG);
      this.ship.visible = s.phase !== 'destroyed';
    }
    this.updateCamera(prox?.state.p ?? null);
  }

  private updateCamera(p: readonly [number, number, number] | null): void {
    const mode: StationCameraMode = this.controller.getCameraMode();
    const cam = this.camera;
    const shipPos = p ? lvlhToModel(p, new THREE.Vector3()) : new THREE.Vector3(80, 10, 30);
    if (mode === 'docking' && p) {
      // From the ship's docking port, looking along the nose at the station port.
      const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.shipInner.getWorldQuaternion(new THREE.Quaternion()),
      );
      cam.position.copy(shipPos).addScaledVector(nose, 0.3);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.tmp.copy(cam.position).addScaledVector(nose, 50));
      cam.fov = 40;
      cam.near = 0.05;
    } else {
      const auto = mode === 'orbit' ? autoMotion(this.time * 0.05) : 0;
      const focus = mode === 'orbit' ? new THREE.Vector3(0, 0, 0) : shipPos;
      const dist = (mode === 'orbit' ? 160 : 70) * this.zoom;
      const dir = new THREE.Vector3(
        Math.cos(this.pitch) * Math.cos(this.yaw + auto),
        Math.sin(this.pitch),
        Math.cos(this.pitch) * Math.sin(this.yaw + auto),
      );
      cam.position.copy(focus).addScaledVector(dir, dist);
      cam.up.set(0, 1, 0);
      if (mode === 'chase') {
        // Look slightly past the ship toward the port, so both stay framed at any range.
        const toPort = new THREE.Vector3(PORT[1], PORT[0], -PORT[2]).sub(focus);
        const ahead = Math.min(toPort.length() * 0.3, dist * 0.35);
        cam.lookAt(this.tmp.copy(focus).addScaledVector(toPort.normalize(), ahead));
      } else cam.lookAt(focus);
      cam.fov = 50;
      cam.near = 0.3;
    }
    cam.far = EARTH_RADIUS_M * 2.5;
    cam.updateProjectionMatrix();
    this.planet?.stars.position.copy(cam.position);
    this.planet?.stars.scale.setScalar(cam.far * 0.8);
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
    this.shipRenderer.clear();
    this.cache.dispose();
    this.envTarget?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  resetView(): void {
    this.yaw = 0.7;
    this.pitch = 0.25;
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
    this.yaw += (e.clientX - this.drag.x) * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -1.3, 1.3);
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.15, 8);
  };
}
