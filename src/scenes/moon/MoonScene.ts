import * as THREE from 'three';
import { autoMotion } from '../../render/motion';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FlightState } from '../../flight/flightModel';
import type { GameScene, SceneContext } from '../../game/GameScene';
import { bodyFrame, moonState, MOON_RADIUS_M, type GravityEnv } from '../../moon/moonOrbit';
import type { LunarView } from '../../moon/lunarFlight';
import { ResourceCache } from '../../render/ResourceCache';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { createEarthTexture } from '../flight/earthTextures';
import { ShipView } from '../flight/ShipView';
import type { MoonCameraMode, MoonController } from './moonController';
import { MoonBody } from './MoonBody';

/** Same sun direction as the Flight scene (inertial frame). */
const SUN_DIR = new THREE.Vector3(0.55, 0.6, 0.58).normalize();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
/** Earth is drawn as a backdrop at this distance (true angular size). */
const EARTH_BACKDROP_M = 6_000_000;

/**
 * Moon: the ship near the Moon with a floating origin (the ship at the scene origin), the
 * turning Moon with site markers and high-detail terrain at the chosen landing site, and Earth
 * in the sky. Cameras: chase, a landing-site ground camera and a wide orbit view.
 */
export class MoonScene implements GameScene {
  readonly id = 'moon' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1e9);

  private readonly cache = new ResourceCache();
  private moon: MoonBody | null = null;
  private ship: ShipView | null = null;
  private earth: THREE.Mesh | null = null;
  private stars: THREE.Points | null = null;
  private dust: THREE.Mesh | null = null;
  private shipMarker: THREE.Mesh | null = null;
  private readonly sun = new THREE.DirectionalLight(0xfff6ea, 3.4);
  private readonly ambient = new THREE.HemisphereLight(0x8090a8, 0x050505, 0.12);
  private canvas: HTMLCanvasElement | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private unsubscribers: (() => void)[] = [];
  private time = 0;
  private yaw = 0.9;
  private pitch = 0.2;
  private zoom = 1;
  private drag: { x: number; y: number } | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();

  constructor(private readonly controller: MoonController) {}

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    const pmrem = new THREE.PMREMGenerator(context.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color(0x000000);
    this.moon = new MoonBody(this.cache);
    this.ship = new ShipView(this.cache);
    this.earth = new THREE.Mesh(
      this.cache.geometry('moon:earth', () =>
        new THREE.SphereGeometry(1, 64, 32).rotateX(Math.PI / 2),
      ),
      this.cache.material(
        'moon:earthMat',
        () =>
          new THREE.MeshStandardMaterial({
            map: this.cache.texture('flight:earthTex', () => createEarthTexture()),
            roughness: 0.8,
            depthWrite: false,
          }),
      ),
    );
    this.earth.renderOrder = -5;
    this.stars = this.buildStars();
    this.dust = new THREE.Mesh(
      this.cache.geometry('moon:dust', () =>
        new THREE.RingGeometry(4, 40, 48).rotateX(-Math.PI / 2),
      ),
      this.cache.material(
        'moon:dustMat',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0xcfc8b8,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    );
    this.shipMarker = new THREE.Mesh(
      this.cache.geometry('moon:shipMarker', () => new THREE.SphereGeometry(1, 12, 8)),
      this.cache.material(
        'moon:shipMarkerMat',
        () => new THREE.MeshBasicMaterial({ color: 0xff4fd8, depthTest: false, transparent: true }),
      ),
    );
    this.shipMarker.renderOrder = 4;
    this.sun.position.copy(SUN_DIR).multiplyScalar(1_000);
    this.scene.add(
      this.sun,
      this.sun.target,
      this.ambient,
      this.stars,
      this.earth,
      this.moon.group,
      this.ship.root,
      this.ship.effects,
      this.dust,
      this.shipMarker,
    );
  }

  private buildStars(): THREE.Points {
    const n = 2_500;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rand = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(), rand(), rand()).normalize();
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.4,
        sizeAttenuation: false,
        depthWrite: false,
      }),
    );
    pts.renderOrder = -10;
    pts.frustumCulled = false;
    return pts;
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
    this.controller.runtime.update(deltaSeconds);
    const snap = this.controller.runtime.current;
    const s = this.controller.runtime.liveState ?? snap.state;
    const lunar = snap.lunar;
    const ship = this.ship!;
    if (!s || !lunar || !snap.context) {
      ship.root.visible = false;
      this.idleView();
      return;
    }
    ship.root.visible = true;
    const env: GravityEnv = lunar.env;
    const m = moonState(env.moon, s.tS);
    const f = bodyFrame('moon', s.r, s.v, s.tS, env);
    this.centre.set(m.r[0] - s.r[0], m.r[1] - s.r[1], 0);
    const toEarth = Math.atan2(-m.r[0], -m.r[1]);
    const moon = this.moon!;
    if (lunar.plan.landing) moon.setSite(lunar.terrain);
    const geo = lunar.geometry;
    const nearSite = !!geo && geo.h < 80_000 && Math.abs(geo.x) < 400_000;
    const onSurface = !!lunar.surface || (s.phase !== 'flight' && s.touchdown?.body === 'moon');
    const mode: MoonCameraMode = this.controller.getCameraMode();
    moon.update(this.centre, toEarth, (nearSite || onSurface) && mode !== 'orbit', 0);
    const camDist = this.updateCamera(mode, s, lunar, f.up, f.altitudeM);
    moon.setMarkers(
      mode === 'orbit' || f.altitudeM > 300_000 ? Math.max(8_000, camDist * 0.006) : 0,
    );
    moon.terrainPatch?.setAim(lunar.landing?.kind === 'descent' ? lunar.landing.aimX : null);

    ship.build(`${snap.context.outcome.id}:${snap.context.designRevision}`, snap.context.blueprint);
    ship.update(s, this.time, deltaSeconds, {
      up: s.ref === 'moon' ? f.up : [s.r[0] / Math.hypot(...s.r), s.r[1] / Math.hypot(...s.r)],
      altitudeM: s.ref === 'moon' ? f.altitudeM : 1e9,
    });

    // Earth as a backdrop in its true direction and angular size.
    const earthDist = Math.hypot(s.r[0], s.r[1]);
    const earth = this.earth!;
    earth.position
      .set(-s.r[0], -s.r[1], 0)
      .normalize()
      .multiplyScalar(EARTH_BACKDROP_M)
      .add(this.camera.position);
    earth.scale.setScalar((EARTH_RADIUS_M * EARTH_BACKDROP_M) / earthDist);

    // Landing-thruster dust on the ground under the ship.
    const dust = this.dust!;
    const low = geo && geo.radarM < 45 && s.phase === 'flight' && s.throttle > 0;
    const dustMat = dust.material as THREE.MeshBasicMaterial;
    dustMat.opacity = low
      ? Math.min(0.45, (45 - geo!.radarM) / 60) * Math.min(1, s.throttle * 2)
      : 0;
    dust.visible = dustMat.opacity > 0.01;
    if (dust.visible && geo) {
      this.up.set(f.up[0], f.up[1], 0);
      dust.position.copy(this.up).multiplyScalar(-geo.radarM + 0.3);
      dust.quaternion.setFromUnitVectors(AXIS_Y, this.up);
      dust.scale.setScalar(1 + (45 - geo.radarM) / 30 + autoMotion(Math.sin(this.time * 9) * 0.05));
    }
    this.stars!.position.copy(this.camera.position);
    this.stars!.scale.setScalar(this.camera.far * 0.9);
  }

  /** Positions the camera; returns its distance from the focus (for marker sizing). */
  private updateCamera(
    mode: MoonCameraMode,
    s: FlightState,
    lunar: LunarView,
    frameUp: readonly [number, number],
    moonAlt: number,
  ): number {
    const cam = this.camera;
    this.up.set(frameUp[0], frameUp[1], 0);
    const marker = this.shipMarker!;
    marker.visible = false;
    if (mode === 'orbit') {
      // Wide view of the Moon from beyond the ship, slowly circling.
      const dist = MOON_RADIUS_M * 4.2 * this.zoom;
      const out = this.tmp.copy(this.centre).multiplyScalar(-1).normalize();
      const dir = out
        .applyAxisAngle(AXIS_Z, this.yaw * 0.5 + autoMotion(this.time * 0.01))
        .multiplyScalar(Math.cos(this.pitch))
        .add(this.tmp2.set(0, 0, Math.sin(this.pitch)))
        .normalize();
      cam.position.copy(this.centre).addScaledVector(dir, dist);
      cam.up.set(0, 0, 1);
      cam.lookAt(this.centre);
      cam.near = Math.max(1_000, dist * 0.02);
      cam.far = dist + MOON_RADIUS_M * 4 + EARTH_BACKDROP_M * 2;
      cam.fov = 40;
      marker.visible = true;
      marker.scale.setScalar(dist * 0.008);
      cam.updateProjectionMatrix();
      return dist;
    }
    const shipLen = this.ship!.lengthM;
    if (mode === 'landing' && lunar.plan.landing) {
      // A ground camera beside the target, looking at the ship.
      const patch = this.moon!.terrainPatch;
      if (patch && (lunar.geometry?.h ?? Infinity) < 200_000) {
        const local = new THREE.Vector3(-180, patch.localY(-180, 90) + 6, 90);
        patch.group.updateWorldMatrix(true, false);
        cam.position.copy(patch.group.localToWorld(local));
        cam.up.copy(this.up);
        cam.lookAt(this.tmp.set(0, 0, 0).addScaledVector(this.up, shipLen * 0.4));
        cam.near = 0.5;
        cam.far = cam.position.distanceTo(this.centre) + MOON_RADIUS_M * 2 + EARTH_BACKDROP_M * 2;
        cam.fov = 45;
        cam.updateProjectionMatrix();
        return cam.position.length();
      }
    }
    // Chase: behind along the ground track and above.
    const vRel = this.tmp.set(s.v[0], s.v[1], 0);
    const mState = moonState(lunar.env.moon, s.tS);
    if (s.ref === 'moon') vRel.sub(this.tmp2.set(mState.v[0], mState.v[1], 0));
    const horiz = vRel.addScaledVector(this.up, -vRel.dot(this.up));
    if (horiz.length() > 0.5) this.fwd.copy(horiz.normalize());
    else this.fwd.set(frameUp[1], -frameUp[0], 0);
    const back = this.back
      .copy(this.fwd)
      .multiplyScalar(-Math.cos(this.yaw))
      .addScaledVector(AXIS_Z, Math.sin(this.yaw));
    const dist = 2.2 * shipLen * this.zoom + 30;
    const focus = this.focus.set(0, 0, 0).addScaledVector(this.up, shipLen * 0.45);
    cam.position
      .copy(focus)
      .addScaledVector(back, dist * Math.cos(this.pitch))
      .addScaledVector(this.up, dist * Math.sin(this.pitch));
    // Stay above the ground near the surface.
    const radar = lunar.geometry?.radarM ?? moonAlt;
    const camHeight = radar + cam.position.dot(this.up);
    if (camHeight < 4) cam.position.addScaledVector(this.up, 4 - camHeight);
    cam.up.copy(this.up);
    cam.lookAt(focus);
    cam.near = 0.5;
    cam.far = this.centre.length() + MOON_RADIUS_M * 1.5 + EARTH_BACKDROP_M * 2;
    cam.fov = 50;
    cam.updateProjectionMatrix();
    return dist;
  }

  private idleView(): void {
    const moon = this.moon!;
    this.centre.set(0, 0, 0);
    moon.update(this.centre, autoMotion(this.time * 0.01), false, 30_000);
    const a = 0.6 + autoMotion(this.time * 0.03);
    const cam = this.camera;
    cam.position.set(
      Math.sin(a) * MOON_RADIUS_M * 3.6,
      Math.cos(a) * MOON_RADIUS_M * 3.6,
      MOON_RADIUS_M * 1.1,
    );
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.near = 10_000;
    cam.far = MOON_RADIUS_M * 8 + EARTH_BACKDROP_M * 2;
    cam.fov = 40;
    cam.updateProjectionMatrix();
    const earth = this.earth!;
    earth.position.set(0, -1, 0.15).normalize().multiplyScalar(EARTH_BACKDROP_M).add(cam.position);
    earth.scale.setScalar((EARTH_RADIUS_M * EARTH_BACKDROP_M) / 384_400_000);
    this.dust!.visible = false;
    this.shipMarker!.visible = false;
    this.stars!.position.copy(cam.position);
    this.stars!.scale.setScalar(cam.far * 0.9);
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
    this.stars?.geometry.dispose();
    (this.stars?.material as THREE.Material | undefined)?.dispose();
    this.cache.dispose();
    this.envTarget?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  resetView(): void {
    this.yaw = 0.9;
    this.pitch = 0.2;
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
    this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -1.2, 1.4);
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.25, 8);
  };
}
