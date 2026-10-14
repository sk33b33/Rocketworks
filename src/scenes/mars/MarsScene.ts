import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FlightState } from '../../flight/flightModel';
import type { GameScene, SceneContext } from '../../game/GameScene';
import type { MarsView } from '../../mars/marsFlight';
import { marsFrame } from '../../mars/marsModel';
import { marsDensity, MARS_RADIUS_M, PLANETS } from '../../mars/solarSystem';
import { autoMotion } from '../../render/motion';
import { ResourceCache } from '../../render/ResourceCache';
import { ShipView } from '../flight/ShipView';
import { MarsBody } from './MarsBody';
import type { MarsCameraMode, MarsController } from './marsController';

/** Scale of the solar-system map: one scene unit per million km. */
const SYSTEM_SCALE = 1e-9;
const SKY_DAY = new THREE.Color(0xc79a6e);
const SKY_SPACE = new THREE.Color(0x000000);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * Mars: near the planet, the ship sits at the scene origin (floating origin) with Mars, its
 * haze and the landing-site terrain around it, and a butterscotch sky low in the atmosphere.
 * During the cruise (or on request) a solar-system map shows the Sun, Earth's and Mars's orbits,
 * the planets, the ship and its predicted path. Cameras: chase, landing site, planet, system.
 */
export class MarsScene implements GameScene {
  readonly id = 'mars' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1e9);

  private readonly cache = new ResourceCache();
  private mars: MarsBody | null = null;
  private ship: ShipView | null = null;
  private stars: THREE.Points | null = null;
  private dust: THREE.Mesh | null = null;
  private readonly system = new THREE.Group();
  private sysEarth: THREE.Mesh | null = null;
  private sysMars: THREE.Mesh | null = null;
  private sysShip: THREE.Mesh | null = null;
  private sysPath: THREE.Line | null = null;
  private sysPathPositions: THREE.BufferAttribute | null = null;
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  private readonly ambient = new THREE.HemisphereLight(0xd8a578, 0x2a1408, 0.18);
  private readonly sky = new THREE.Color();
  private canvas: HTMLCanvasElement | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private unsubscribers: (() => void)[] = [];
  private time = 0;
  private yaw = 0.9;
  private pitch = 0.25;
  private zoom = 1;
  private drag: { x: number; y: number } | null = null;
  private readonly centre = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();

  constructor(private readonly controller: MarsController) {}

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    const pmrem = new THREE.PMREMGenerator(context.renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = this.sky.set(0x000000);
    this.mars = new MarsBody(this.cache);
    this.ship = new ShipView(this.cache);
    this.stars = this.buildStars();
    this.dust = new THREE.Mesh(
      this.cache.geometry('mars:dust', () =>
        new THREE.RingGeometry(4, 50, 48).rotateX(-Math.PI / 2),
      ),
      this.cache.material(
        'mars:dustMat',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0xd49a6a,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    );
    this.buildSystem();
    this.sun.position.set(0, 1_000, 400);
    this.scene.add(
      this.sun,
      this.sun.target,
      this.ambient,
      this.stars,
      this.mars.group,
      this.ship.root,
      this.ship.effects,
      this.dust,
      this.system,
    );
  }

  private buildStars(): THREE.Points {
    const n = 2_500;
    const pos = new Float32Array(n * 3);
    let seed = 11;
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

  /** The solar-system map: Sun, orbits, planets, ship marker and predicted path. */
  private buildSystem(): void {
    const dot = this.cache.geometry('mars:sysDot', () => new THREE.SphereGeometry(1, 20, 12));
    const basic = (key: string, color: number) =>
      this.cache.material(key, () => new THREE.MeshBasicMaterial({ color }));
    const sunMesh = new THREE.Mesh(dot, basic('mars:sysSun', 0xffd27a));
    sunMesh.scale.setScalar(5);
    this.sysEarth = new THREE.Mesh(dot, basic('mars:sysEarth', 0x4f9dff));
    this.sysMars = new THREE.Mesh(dot, basic('mars:sysMars', 0xe0663a));
    this.sysShip = new THREE.Mesh(dot, basic('mars:sysShip', 0xff4fd8));
    this.sysEarth.scale.setScalar(2.4);
    this.sysMars.scale.setScalar(2);
    this.sysShip.scale.setScalar(1.6);
    const ring = (radiusM: number, color: number, key: string) => {
      const r = radiusM * SYSTEM_SCALE;
      const pts = Array.from({ length: 257 }, (_, i) => {
        const a = (i / 256) * Math.PI * 2;
        return new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r, 0);
      });
      return new THREE.Line(
        this.cache.geometry(key, () => new THREE.BufferGeometry().setFromPoints(pts)),
        this.cache.material(
          `${key}:mat`,
          () => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }),
        ),
      );
    };
    const pathGeo = new THREE.BufferGeometry();
    this.sysPathPositions = new THREE.BufferAttribute(new Float32Array(130 * 3), 3);
    this.sysPathPositions.setUsage(THREE.DynamicDrawUsage);
    pathGeo.setAttribute('position', this.sysPathPositions);
    this.sysPath = new THREE.Line(
      pathGeo,
      this.cache.material(
        'mars:sysPathMat',
        () => new THREE.LineBasicMaterial({ color: 0x4fd1ff }),
      ),
    );
    this.sysPath.frustumCulled = false;
    this.system.add(
      sunMesh,
      ring(PLANETS.earth.radiusM, 0x4f9dff, 'mars:earthRing'),
      ring(PLANETS.mars.radiusM, 0xe0663a, 'mars:marsRing'),
      this.sysEarth,
      this.sysMars,
      this.sysShip,
      this.sysPath,
    );
    this.system.visible = false;
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
    const rt = this.controller.runtime;
    // A Mars mission is flown from here (and from Flight / Orbit while still at Earth).
    if (rt.current.mars) rt.update(deltaSeconds);
    const snap = rt.current;
    const s = rt.liveState ?? snap.state;
    const mars = snap.mars;
    if (!s || !mars || !snap.context) {
      this.ship!.root.visible = false;
      this.idleView();
      return;
    }
    const onSurface = !!mars.surface || (s.phase !== 'flight' && s.touchdown?.body === 'mars');
    const nearMars = s.origin === 'mars' || onSurface;
    const requested = this.controller.getCameraMode();
    const mode: MarsCameraMode = nearMars ? requested : 'system';
    if (mode === 'system') {
      this.systemView(mars);
      return;
    }
    this.system.visible = false;
    this.mars!.group.visible = true;
    const ship = this.ship!;
    ship.root.visible = true;
    const f = marsFrame(s.r);
    this.centre.set(-s.r[0], -s.r[1], 0);
    const body = this.mars!;
    if (mars.siteAngle !== null) body.setSite(mars.terrain, mars.siteAngle);
    const geo = mars.geometry;
    const nearSite =
      mars.siteAngle !== null &&
      !!geo &&
      geo.radarM < 80_000 &&
      Math.abs(geo.x ?? Infinity) < 400_000;
    body.update(this.centre, (nearSite || onSurface) && mode !== 'planet');
    body.terrainPatch?.setAim(
      mars.descent && mars.descent.phase !== 'entry' ? mars.descent.aimX : null,
    );

    ship.build(`${snap.context.outcome.id}:${snap.context.designRevision}`, snap.context.blueprint);
    ship.update(s, this.time, deltaSeconds, {
      up: f.up,
      altitudeM: f.altitudeM,
      inAir: marsDensity(f.altitudeM) > 1e-4,
    });

    // Light from the Sun's true direction (seen from Mars), lifted out of the plane a little.
    this.sun.position.set(-mars.mars.r[0], -mars.mars.r[1], 0).normalize();
    this.sun.position.z = 0.45;
    this.sun.position.normalize().multiplyScalar(1_000);

    // The sky turns butterscotch low in the atmosphere.
    const rho = marsDensity(Math.max(0, f.altitudeM));
    const k = Math.min(1, rho / 0.012);
    this.sky.copy(SKY_SPACE).lerp(SKY_DAY, k);
    this.scene.background = this.sky;
    this.stars!.visible = k < 0.5;

    // Engine dust on the ground under the ship.
    const dust = this.dust!;
    const low = geo && geo.radarM < 60 && s.phase === 'flight' && s.throttle > 0;
    const dustMat = dust.material as THREE.MeshBasicMaterial;
    dustMat.opacity = low
      ? Math.min(0.55, (60 - geo!.radarM) / 70) * Math.min(1, s.throttle * 6)
      : 0;
    dust.visible = dustMat.opacity > 0.01;
    if (dust.visible && geo) {
      this.up.set(f.up[0], f.up[1], 0);
      dust.position.copy(this.up).multiplyScalar(-geo.radarM + 0.3);
      dust.quaternion.setFromUnitVectors(AXIS_Y, this.up);
      dust.scale.setScalar(1 + (60 - geo.radarM) / 30 + autoMotion(Math.sin(this.time * 9) * 0.05));
    }
    this.updateCamera(mode, s, mars, f.up, f.altitudeM);
    this.stars!.position.copy(this.camera.position);
    this.stars!.scale.setScalar(this.camera.far * 0.9);
  }

  private systemView(mars: MarsView): void {
    this.mars!.group.visible = false;
    this.ship!.root.visible = false;
    this.dust!.visible = false;
    this.system.visible = true;
    this.scene.background = this.sky.set(0x000000);
    this.stars!.visible = true;
    const put = (m: THREE.Object3D, r: readonly [number, number]) =>
      m.position.set(r[0] * SYSTEM_SCALE, r[1] * SYSTEM_SCALE, 0);
    put(this.sysEarth!, mars.earth.r);
    put(this.sysMars!, mars.mars.r);
    put(this.sysShip!, mars.shipHelio);
    const pos = this.sysPathPositions!;
    const arr = pos.array as Float32Array;
    const n = Math.min(130, mars.path.length);
    for (let i = 0; i < n; i++) {
      const p = mars.path[i]!;
      arr[i * 3] = p[0] * SYSTEM_SCALE;
      arr[i * 3 + 1] = p[1] * SYSTEM_SCALE;
      arr[i * 3 + 2] = 0;
    }
    pos.needsUpdate = true;
    this.sysPath!.geometry.setDrawRange(0, n);
    // Looking down on the plane, tilted by the drag, framing both orbits.
    const cam = this.camera;
    const dist = 560 * this.zoom;
    const tilt = THREE.MathUtils.clamp(0.35 + this.pitch, 0.05, 1.3);
    cam.position
      .set(0, -Math.sin(tilt) * dist, Math.cos(tilt) * dist)
      .applyAxisAngle(AXIS_Z, this.yaw - 0.9);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.near = 1;
    cam.far = 5_000;
    cam.fov = 45;
    cam.updateProjectionMatrix();
    this.stars!.position.copy(cam.position);
    this.stars!.scale.setScalar(cam.far * 0.9);
  }

  private updateCamera(
    mode: MarsCameraMode,
    s: FlightState,
    mars: MarsView,
    frameUp: readonly [number, number],
    altitudeM: number,
  ): void {
    const cam = this.camera;
    this.up.set(frameUp[0], frameUp[1], 0);
    if (mode === 'planet') {
      const dist = MARS_RADIUS_M * 3.4 * this.zoom;
      const out = this.tmp.copy(this.centre).multiplyScalar(-1).normalize();
      const dir = out
        .applyAxisAngle(AXIS_Z, this.yaw * 0.5 + autoMotion(this.time * 0.01))
        .multiplyScalar(Math.cos(this.pitch))
        .addScaledVector(AXIS_Z, Math.sin(this.pitch))
        .normalize();
      cam.position.copy(this.centre).addScaledVector(dir, dist);
      cam.up.set(0, 0, 1);
      cam.lookAt(this.centre);
      cam.near = Math.max(1_000, dist * 0.02);
      cam.far = dist + MARS_RADIUS_M * 4;
      cam.fov = 40;
      cam.updateProjectionMatrix();
      return;
    }
    const shipLen = this.ship!.lengthM;
    const patch = this.mars!.terrainPatch;
    if (mode === 'site' && patch && patch.group.visible) {
      // A ground camera beside the target, looking at the ship.
      const local = new THREE.Vector3(-200, patch.localY(-200, 110) + 6, 110);
      patch.group.updateWorldMatrix(true, false);
      cam.position.copy(patch.group.localToWorld(local));
      cam.up.copy(this.up);
      cam.lookAt(this.tmp.set(0, 0, 0).addScaledVector(this.up, shipLen * 0.4));
      cam.near = 0.5;
      cam.far = cam.position.distanceTo(this.centre) + MARS_RADIUS_M * 2;
      cam.fov = 45;
      cam.updateProjectionMatrix();
      return;
    }
    // Chase: behind along the ground track and above.
    const vel = this.tmp.set(s.v[0], s.v[1], 0);
    const horiz = vel.addScaledVector(this.up, -vel.dot(this.up));
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
    const radar = mars.geometry?.radarM ?? altitudeM;
    const camHeight = radar + cam.position.dot(this.up);
    if (camHeight < 4) cam.position.addScaledVector(this.up, 4 - camHeight);
    cam.up.copy(this.up);
    cam.lookAt(focus);
    cam.near = 0.5;
    cam.far = this.centre.length() + MARS_RADIUS_M * 1.5;
    cam.fov = 50;
    cam.updateProjectionMatrix();
  }

  /** No Mars flight: the planet turning slowly in view. */
  private idleView(): void {
    this.system.visible = false;
    const body = this.mars!;
    body.group.visible = true;
    this.centre.set(0, 0, 0);
    body.update(this.centre, false);
    body.group.rotation.set(0, 0, autoMotion(this.time * 0.02));
    const a = 0.6;
    const cam = this.camera;
    cam.position.set(
      Math.sin(a) * MARS_RADIUS_M * 3.4,
      Math.cos(a) * MARS_RADIUS_M * 3.4,
      MARS_RADIUS_M,
    );
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    cam.near = 10_000;
    cam.far = MARS_RADIUS_M * 10;
    cam.fov = 40;
    cam.updateProjectionMatrix();
    this.sun.position.set(0.4, 1, 0.35).normalize().multiplyScalar(1_000);
    this.scene.background = this.sky.set(0x000000);
    this.dust!.visible = false;
    this.stars!.visible = true;
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
    this.mars?.dispose();
    this.stars?.geometry.dispose();
    (this.stars?.material as THREE.Material | undefined)?.dispose();
    this.sysPath?.geometry.dispose();
    this.cache.dispose();
    this.envTarget?.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  resetView(): void {
    this.yaw = 0.9;
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
    this.yaw -= (e.clientX - this.drag.x) * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -1.2, 1.4);
    this.drag = { x: e.clientX, y: e.clientY };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.25, 8);
  };
}
