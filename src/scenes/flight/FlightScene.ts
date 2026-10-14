import * as THREE from 'three';
import { autoMotion } from '../../render/motion';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FlightState } from '../../flight/flightModel';
import { flownFromMars } from '../../flight/flightRuntime';
import { localFrame } from '../../flight/orbitMath';
import type { GameScene, SceneContext } from '../../game/GameScene';
import { ResourceCache } from '../../render/ResourceCache';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { skyColor } from '../launch-pad/flightView';
import type { FlightCameraMode, FlightController } from './flightController';
import { OrbitOverlay } from './OrbitOverlay';
import { Planet } from './Planet';
import { ShipView } from './ShipView';
import { StationModel } from '../station/StationModel';
import { stationState, type StationState } from '../../station/stationOrbit';
import { MoonBody } from '../moon/MoonBody';
import { bodyFrame, MOON_DISTANCE_M, MOON_RADIUS_M, moonState } from '../../moon/moonOrbit';
import type { LunarOverlay } from './OrbitOverlay';

/** Fixed sun direction in the inertial frame (the day side faces the launch site's morning). */
const SUN_DIR = new THREE.Vector3(0.55, 0.6, 0.58).normalize();

/**
 * Flight / Orbit: the ship over a procedural Earth, using a floating origin (the ship sits at
 * the scene origin and the planet moves around it) so close-up rendering stays precise.
 */
export class FlightScene implements GameScene {
  readonly id = 'flight' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2e7);

  private readonly cache = new ResourceCache();
  private planet: Planet | null = null;
  private stationModel: StationModel | null = null;
  private readonly stationBasis = new THREE.Matrix4();
  private ship: ShipView | null = null;
  private moon: MoonBody | null = null;
  private overlay: OrbitOverlay | null = null;
  private readonly sun = new THREE.DirectionalLight(0xfff3e0, 3.2);
  private readonly ambient = new THREE.HemisphereLight(0x8fb4ff, 0x0b0d12, 0.35);
  private canvas: HTMLCanvasElement | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private unsubscribers: (() => void)[] = [];
  private time = 0;

  // Camera parameters per mode (dragging and the wheel adjust them).
  private yaw = 0.6;
  private pitch = 0.25;
  private zoom = 1;
  private mapYaw = 0;
  private mapPitch = 1.1;
  private mapZoom = 1;
  /** Map camera distance at zoom 1 (larger on Moon missions). */
  private mapBase = EARTH_RADIUS_M * 3.4;
  /** Map focus relative to Earth's centre (halfway to the Moon in the Earth–Moon view). */
  private readonly mapFocus = new THREE.Vector3();
  private drag: { x: number; y: number } | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly sky = new THREE.Color();

  constructor(private readonly controller: FlightController) {}

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    const pmrem = new THREE.PMREMGenerator(context.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.45;
    this.scene.background = new THREE.Color(0x000000);
    this.planet = new Planet(this.cache);
    this.ship = new ShipView(this.cache);
    this.overlay = new OrbitOverlay(this.cache);
    this.sun.position.copy(SUN_DIR).multiplyScalar(1_000);
    this.scene.add(this.sun, this.sun.target, this.ambient);
    this.stationModel = new StationModel(this.cache);
    this.stationModel.root.visible = false;
    this.moon = new MoonBody(this.cache);
    this.moon.group.visible = false;
    this.scene.add(this.moon.group);
    this.scene.add(
      this.planet.group,
      this.planet.stars,
      this.ship.root,
      this.ship.effects,
      this.stationModel.root,
    );
    this.planet.group.add(this.overlay.group);
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

  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    // The scene drives the flight runtime only while Flight is the active location. A Mars
    // voyage (or a ship on Mars) is flown from the Mars location instead.
    const cur = this.controller.runtime.current;
    if (flownFromMars({ ...cur, state: this.controller.runtime.liveState ?? cur.state })) {
      this.ship!.root.visible = false;
      this.idleView();
      return;
    }
    this.controller.runtime.update(deltaSeconds);
    const snap = this.controller.runtime.current;
    const s = this.controller.runtime.liveState ?? snap.state;
    const ship = this.ship!;
    const planet = this.planet!;
    ship.root.visible = !!s;
    if (!s || !snap.context) {
      // Nothing in flight: a quiet view of the planet from orbit.
      this.idleView();
      return;
    }
    ship.build(`${snap.context.outcome.id}:${snap.context.designRevision}`, snap.context.blueprint);
    const lunarEnv = snap.lunar?.env;
    if (lunarEnv && s.ref === 'moon') {
      const mf = bodyFrame('moon', s.r, s.v, s.tS, lunarEnv);
      ship.update(s, this.time, deltaSeconds, { up: mf.up, altitudeM: mf.altitudeM });
    } else ship.update(s, this.time, deltaSeconds);
    const f = localFrame(s.r);
    this.centre.set(-s.r[0], -s.r[1], 0);
    const mode: FlightCameraMode = this.controller.getCameraMode();
    const lunar = snap.lunar;
    const m = lunar ? moonState(lunar.env.moon, s.tS) : null;
    // Moon missions: the map frames the Earth–Moon system once the ship heads out.
    const system =
      !!lunar &&
      !!m &&
      (lunar.path.length > 1 || s.ref === 'moon' || Math.hypot(...s.r) > 30_000_000);
    this.mapBase = system ? MOON_DISTANCE_M * 1.9 : EARTH_RADIUS_M * 3.4;
    if (system && m) this.mapFocus.set(m.r[0] / 2, m.r[1] / 2, 0);
    else this.mapFocus.set(0, 0, 0);
    this.updateCamera(mode, s);
    if (m)
      this.camera.far = Math.max(
        this.camera.far,
        Math.hypot(m.r[0] - s.r[0], m.r[1] - s.r[1]) + MOON_RADIUS_M * 2,
      );
    this.camera.updateProjectionMatrix();
    const camAlt = this.camera.position.distanceTo(this.centre) - EARTH_RADIUS_M;
    const mapDist = mode === 'map' ? this.camera.position.distanceTo(this.centre) : null;
    planet.update(this.centre, f.groundAngle, f.altitudeM, camAlt, SUN_DIR, snap.zone, mapDist);
    const st = snap.station ? stationState(snap.station.eph, s.tS) : null;
    const moon = this.moon!;
    moon.group.visible = !!m;
    let lunarOverlay: LunarOverlay | null = null;
    if (m && lunar) {
      moon.update(
        this.tmp.set(m.r[0] - s.r[0], m.r[1] - s.r[1], 0),
        Math.atan2(-m.r[0], -m.r[1]),
        false,
        0,
      );
      lunarOverlay = { path: lunar.path, moonR: m.r, moonV: m.v, nearMoon: s.ref === 'moon' };
    }
    this.overlay!.update(s, snap.zone, mapDist, st, lunarOverlay);
    this.placeStation(st, s, mode === 'map');
    this.updateSky(camAlt);
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
    this.ship?.dispose();
    this.moon?.dispose();
    this.overlay?.dispose();
    this.cache.dispose();
    this.envTarget?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  // ---------- camera ----------

  private idleView(): void {
    const a = 0.5 + autoMotion(this.time * 0.02);
    this.centre.set(0, 0, 0);
    this.planet!.group.position.set(0, 0, 0);
    this.overlay!.group.visible = false;
    const cam = this.camera;
    cam.position.set(
      Math.sin(a) * EARTH_RADIUS_M * 2.6,
      Math.cos(a) * EARTH_RADIUS_M * 2.6,
      EARTH_RADIUS_M * 1.2,
    );
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.near = 50_000;
    cam.far = EARTH_RADIUS_M * 6;
    cam.fov = 40;
    cam.updateProjectionMatrix();
    this.planet!.stars.position.copy(cam.position);
    this.planet!.stars.scale.setScalar(cam.far * 0.9);
    this.planet!.update(
      this.centre,
      0,
      1e9,
      EARTH_RADIUS_M * 2,
      SUN_DIR,
      { id: '', name: '', kind: 'splash', groundAngle: 0, toleranceM: 0, description: '' },
      null,
    );
    (this.scene.background as THREE.Color).set(0x000000);
    this.planet!.stars.visible = true;
  }

  /** The station model near the ship (floating origin), in its own local frame. */
  private placeStation(st: StationState | null, s: FlightState, map: boolean): void {
    const model = this.stationModel;
    if (!model) return;
    const dx = st ? st.r[0] - s.r[0] : 0;
    const dy = st ? st.r[1] - s.r[1] : 0;
    model.root.visible = !!st && !map && Math.hypot(dx, dy) < 60_000;
    if (!st || !model.root.visible) return;
    model.update(this.time);
    model.root.position.set(dx, dy, 0);
    // Model X = along-track (east), Y = up, Z = scene +Z (right-handed).
    this.stationBasis.makeBasis(
      new THREE.Vector3(st.east[0], st.east[1], 0),
      new THREE.Vector3(st.up[0], st.up[1], 0),
      new THREE.Vector3(0, 0, 1),
    );
    model.root.quaternion.setFromRotationMatrix(this.stationBasis);
  }

  private updateCamera(mode: FlightCameraMode, s: FlightState): void {
    const cam = this.camera;
    const f = localFrame(s.r);
    this.up.set(f.up[0], f.up[1], 0);
    const speed = Math.hypot(s.v[0], s.v[1]);
    if (speed > 1) this.fwd.set(s.v[0] / speed, s.v[1] / speed, 0);
    else this.fwd.set(f.east[0], f.east[1], 0);
    const shipLen = this.ship!.lengthM;
    const focus = this.tmp.set(0, 0, 0);

    if (mode === 'map') {
      const dist = this.mapBase * this.mapZoom;
      const dir = new THREE.Vector3(
        Math.sin(this.mapYaw) * Math.cos(this.mapPitch),
        -Math.cos(this.mapYaw) * Math.cos(this.mapPitch),
        Math.sin(this.mapPitch),
      );
      const target = this.tmp.copy(this.centre).add(this.mapFocus);
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.fov = 40;
      const extent = Math.max(EARTH_RADIUS_M * 1.5, this.mapBase * 0.6);
      cam.near = Math.max(1_000, dist - extent);
      cam.far = dist + extent;
    } else {
      // Chase: behind along the flight path and above; Orbit: a slow cinematic circle.
      const yaw = mode === 'orbit' ? this.yaw + autoMotion(this.time * 0.06) : this.yaw;
      const pitch = this.pitch;
      const side = new THREE.Vector3(0, 0, 1);
      const back = this.fwd
        .clone()
        .multiplyScalar(-Math.cos(yaw))
        .addScaledVector(side, Math.sin(yaw));
      const dist = (mode === 'orbit' ? 2.6 : 1.6) * shipLen * this.zoom + 20;
      focus
        .copy(this.up)
        .multiplyScalar(0)
        .addScaledVector(this.shipAxis(s), shipLen * 0.45);
      cam.position
        .copy(focus)
        .addScaledVector(back, dist * Math.cos(pitch))
        .addScaledVector(this.up, dist * Math.sin(pitch));
      // Never below the surface.
      const camAlt = cam.position.distanceTo(this.centre) - EARTH_RADIUS_M;
      if (camAlt < 3) cam.position.addScaledVector(this.up, 3 - camAlt);
      cam.up.copy(this.up);
      cam.lookAt(focus);
      cam.fov = 50;
      cam.near = 0.5;
      cam.far = cam.position.distanceTo(this.centre) + EARTH_RADIUS_M * 1.2;
    }
    cam.updateProjectionMatrix();
    this.planet!.stars.position.copy(cam.position);
    this.planet!.stars.scale.setScalar(cam.far * 0.8);
  }

  private shipAxis(s: FlightState): THREE.Vector3 {
    const f = localFrame(s.r);
    const p = (s.pitchDeg * Math.PI) / 180;
    return new THREE.Vector3(
      f.east[0] * Math.cos(p) + f.up[0] * Math.sin(p),
      f.east[1] * Math.cos(p) + f.up[1] * Math.sin(p),
      0,
    );
  }

  private updateSky(camAlt: number): void {
    skyColor(camAlt, this.sky);
    (this.scene.background as THREE.Color).copy(this.sky);
    // Stars only above the bright lower atmosphere (opaque points, painted first).
    this.planet!.stars.visible = camAlt > 35_000;
  }

  resetView(): void {
    this.yaw = 0.6;
    this.pitch = 0.25;
    this.zoom = 1;
    this.mapYaw = 0;
    this.mapPitch = 1.1;
    this.mapZoom = 1;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onPointerUp = (): void => {
    this.drag = null;
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.drag) return;
    const dx = (e.clientX - this.drag.x) * 0.005;
    const dy = (e.clientY - this.drag.y) * 0.004;
    if (this.controller.getCameraMode() === 'map') {
      this.mapYaw -= dx;
      this.mapPitch = THREE.MathUtils.clamp(this.mapPitch + dy, 0.05, Math.PI / 2 - 0.01);
    } else {
      this.yaw -= dx;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -1.2, 1.4);
    }
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const k = e.deltaY > 0 ? 1.1 : 0.9;
    if (this.controller.getCameraMode() === 'map')
      this.mapZoom = THREE.MathUtils.clamp(
        this.mapZoom * k,
        this.mapBase > EARTH_RADIUS_M * 10 ? 0.02 : 0.4,
        3,
      );
    else this.zoom = THREE.MathUtils.clamp(this.zoom * k, 0.3, 8);
  };
}
