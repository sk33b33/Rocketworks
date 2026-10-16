import * as THREE from 'three';
import type { FlightState } from '../../flight/flightModel';
import type { LandingZone } from '../../flight/landingZones';
import { localFrame, orbitalElements, orbitPath } from '../../flight/orbitMath';
import type { ResourceCache } from '../../render/ResourceCache';
import type { NodePlan } from '../../flight/maneuver';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { STATION_RADIUS_M } from '../../station/stationOrbit';
import { MOON_DISTANCE_M, MOON_RADIUS_M } from '../../moon/moonOrbit';
import { MOON_BODY } from '../../moon/lunarTransfer';

/** Moon-mission extras for the map: the predicted path, the Moon and the ship's lunar orbit. */
export interface LunarOverlay {
  readonly path: readonly (readonly [number, number])[];
  readonly moonR: readonly [number, number];
  readonly moonV: readonly [number, number];
  readonly nearMoon: boolean;
}

/*
 * Map-view overlay in Earth-centred coordinates (child of the planet group): the predicted
 * orbit or ballistic path, apoapsis/periapsis markers and a ship marker.
 */

const SAMPLES = 512;

export class OrbitOverlay {
  readonly group = new THREE.Group();
  private readonly line: THREE.Line;
  private readonly positions: THREE.BufferAttribute;
  private readonly lineMat: THREE.LineBasicMaterial;
  private readonly apo: THREE.Mesh;
  private readonly peri: THREE.Mesh;
  private readonly shipMarker: THREE.Mesh;
  private readonly stationMarker: THREE.Mesh;
  private readonly stationRing: THREE.Line;
  private readonly moonMarker: THREE.Mesh;
  private readonly moonRing: THREE.Line;
  /** A planned manoeuvre: the orbit after the burn (dashed) and the burn point. */
  private readonly planLine: THREE.Line;
  private readonly planPositions: THREE.BufferAttribute;
  private readonly planMat: THREE.LineDashedMaterial;
  private readonly nodeMarker: THREE.Mesh;

  constructor(cache: ResourceCache) {
    const geo = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array((SAMPLES + 1) * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positions);
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0x4fd1ff,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    this.line = new THREE.Line(geo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 1;
    const dot = cache.geometry('flight:overlayDot', () => new THREE.SphereGeometry(1, 16, 12));
    const mat = (key: string, color: number) =>
      cache.material(
        key,
        () =>
          new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, fog: false }),
      );
    this.apo = new THREE.Mesh(dot, mat('flight:apo', 0xc7a6ff));
    this.peri = new THREE.Mesh(dot, mat('flight:peri', 0xff6b6b));
    this.shipMarker = new THREE.Mesh(dot, mat('flight:shipMarker', 0xff4fd8));
    this.stationMarker = new THREE.Mesh(dot, mat('flight:stationMarker', 0xffffff));
    for (const m of [this.apo, this.peri, this.shipMarker, this.stationMarker]) m.renderOrder = 3;
    const ringPts = Array.from({ length: 257 }, (_, i) => {
      const a = (i / 256) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(a) * STATION_RADIUS_M, Math.cos(a) * STATION_RADIUS_M, 0);
    });
    this.stationRing = new THREE.Line(
      cache.geometry('flight:stationRing', () => new THREE.BufferGeometry().setFromPoints(ringPts)),
      cache.material(
        'flight:stationRingMat',
        () =>
          new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.25,
            depthTest: false,
            fog: false,
          }),
      ),
    );
    this.stationRing.renderOrder = 1;
    this.stationRing.frustumCulled = false;
    this.moonMarker = new THREE.Mesh(dot, mat('flight:moonMarker', 0xd8d4cc));
    this.moonMarker.renderOrder = 2;
    const moonPts = Array.from({ length: 257 }, (_, i) => {
      const a = (i / 256) * Math.PI * 2;
      return new THREE.Vector3(Math.sin(a) * MOON_DISTANCE_M, Math.cos(a) * MOON_DISTANCE_M, 0);
    });
    this.moonRing = new THREE.Line(
      cache.geometry('flight:moonRing', () => new THREE.BufferGeometry().setFromPoints(moonPts)),
      cache.material(
        'flight:moonRingMat',
        () =>
          new THREE.LineBasicMaterial({
            color: 0xd8d4cc,
            transparent: true,
            opacity: 0.2,
            depthTest: false,
            fog: false,
          }),
      ),
    );
    this.moonRing.frustumCulled = false;
    const planGeo = new THREE.BufferGeometry();
    this.planPositions = new THREE.BufferAttribute(new Float32Array((SAMPLES + 1) * 3), 3);
    this.planPositions.setUsage(THREE.DynamicDrawUsage);
    planGeo.setAttribute('position', this.planPositions);
    this.planMat = new THREE.LineDashedMaterial({
      color: 0xffd23f,
      dashSize: 1,
      gapSize: 1,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
      fog: false,
    });
    this.planLine = new THREE.Line(planGeo, this.planMat);
    this.planLine.frustumCulled = false;
    this.planLine.renderOrder = 1;
    this.planLine.visible = false;
    this.nodeMarker = new THREE.Mesh(dot, mat('flight:nodeMarker', 0xffd23f));
    this.nodeMarker.renderOrder = 3;
    this.nodeMarker.visible = false;
    this.group.add(
      this.planLine,
      this.nodeMarker,
      this.line,
      this.apo,
      this.peri,
      this.shipMarker,
      this.stationMarker,
      this.stationRing,
      this.moonMarker,
      this.moonRing,
    );
    this.group.visible = false;
  }

  /** `mapScale` = camera distance in map view, or null to hide the overlay. */
  update(
    s: FlightState,
    zone: LandingZone,
    mapScale: number | null,
    station: { readonly r: readonly [number, number] } | null = null,
    lunar: LunarOverlay | null = null,
    plan: NodePlan | null = null,
  ): void {
    this.updatePlan(plan, mapScale);
    this.moonMarker.visible = !!lunar;
    this.moonRing.visible = !!lunar;
    if (lunar && mapScale !== null) {
      this.moonMarker.position.set(lunar.moonR[0], lunar.moonR[1], 0);
      this.moonMarker.scale.setScalar(Math.max(MOON_RADIUS_M, mapScale * 0.008));
    }
    this.stationMarker.visible = !!station;
    this.stationRing.visible = !!station;
    if (station && mapScale !== null) {
      this.stationMarker.position.set(station.r[0], station.r[1], 0);
      this.stationMarker.scale.setScalar(mapScale * 0.009);
    }
    void zone;
    this.group.visible = mapScale !== null;
    if (mapScale === null) return;
    const el = orbitalElements(s.r, s.v);
    const f = localFrame(s.r);
    const arr = this.positions.array as Float32Array;
    let n = 0;
    const put = (x: number, y: number) => {
      if (n > SAMPLES) return;
      arr[n * 3] = x;
      arr[n * 3 + 1] = y;
      arr[n * 3 + 2] = 0;
      n++;
    };
    if (lunar && s.phase === 'flight' && lunar.path.length > 1) {
      // Numerically predicted Earth–Moon trajectory.
      for (const p of lunar.path) put(p[0], p[1]);
    } else if (lunar?.nearMoon && s.phase === 'flight') {
      // A closed orbit around the Moon, drawn around the Moon's current position.
      const rel: [number, number] = [s.r[0] - lunar.moonR[0], s.r[1] - lunar.moonR[1]];
      const vr: [number, number] = [s.v[0] - lunar.moonV[0], s.v[1] - lunar.moonV[1]];
      const mel = orbitalElements(rel, vr, MOON_BODY);
      for (const p of orbitPath(mel, Math.atan2(rel[0], rel[1]), 256, MOON_RADIUS_M))
        put(
          lunar.moonR[0] + Math.sin(p.angle) * p.radiusM,
          lunar.moonR[1] + Math.cos(p.angle) * p.radiusM,
        );
    } else if (s.phase === 'flight') {
      for (const p of orbitPath(el, f.groundAngle, 256))
        put(Math.sin(p.angle) * p.radiusM, Math.cos(p.angle) * p.radiusM);
    }
    this.line.geometry.setDrawRange(0, n);
    this.positions.needsUpdate = true;
    this.lineMat.color.set(
      el.status === 'orbit' ? 0x4fd1ff : el.status === 'escape' ? 0xff6bd5 : 0xffa64d,
    );

    const size = mapScale * 0.007;
    this.shipMarker.position.set(s.r[0], s.r[1], 0);
    this.shipMarker.scale.setScalar(size * 1.5);
    const bounded =
      !lunar?.nearMoon &&
      !(lunar && lunar.path.length > 1) &&
      el.status !== 'escape' &&
      s.phase === 'flight' &&
      el.eccentricity > 0.002;
    this.apo.visible = bounded;
    this.peri.visible = bounded && el.periapsisAltM > 0;
    if (bounded) {
      const ra = EARTH_RADIUS_M + el.apoapsisAltM;
      const rp = EARTH_RADIUS_M + el.periapsisAltM;
      const a = el.periapsisAngle;
      this.peri.position.set(Math.sin(a) * rp, Math.cos(a) * rp, 0);
      this.apo.position.set(Math.sin(a + Math.PI) * ra, Math.cos(a + Math.PI) * ra, 0);
      this.apo.scale.setScalar(size);
      this.peri.scale.setScalar(size);
    }
  }

  /** The orbit after a planned burn, dashed, from the burn point once round. */
  private updatePlan(plan: NodePlan | null, mapScale: number | null): void {
    const show = !!plan && mapScale !== null;
    this.planLine.visible = show;
    this.nodeMarker.visible = show;
    if (!plan || mapScale === null) return;
    const arr = this.planPositions.array as Float32Array;
    let n = 0;
    const from = localFrame(plan.at.r).groundAngle;
    for (const p of orbitPath(plan.elements, from, SAMPLES)) {
      arr[n * 3] = Math.sin(p.angle) * p.radiusM;
      arr[n * 3 + 1] = Math.cos(p.angle) * p.radiusM;
      arr[n * 3 + 2] = 0;
      n++;
    }
    this.planLine.geometry.setDrawRange(0, n);
    this.planPositions.needsUpdate = true;
    this.planLine.computeLineDistances();
    // Dashes a fixed size on screen.
    this.planMat.dashSize = mapScale * 0.012;
    this.planMat.gapSize = mapScale * 0.008;
    this.nodeMarker.position.set(plan.at.r[0], plan.at.r[1], 0);
    this.nodeMarker.scale.setScalar(mapScale * 0.011);
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.lineMat.dispose();
    this.planLine.geometry.dispose();
    this.planMat.dispose();
  }
}
