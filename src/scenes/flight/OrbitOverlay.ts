import * as THREE from 'three';
import type { FlightState } from '../../flight/flightModel';
import type { LandingZone } from '../../flight/landingZones';
import { localFrame, orbitalElements, orbitPath } from '../../flight/orbitMath';
import type { ResourceCache } from '../../render/ResourceCache';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { STATION_RADIUS_M } from '../../station/stationOrbit';

/*
 * Map-view overlay in Earth-centred coordinates (child of the planet group): the predicted
 * orbit or ballistic path, apoapsis/periapsis markers and a ship marker.
 */

const SAMPLES = 256;

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
    this.group.add(
      this.line,
      this.apo,
      this.peri,
      this.shipMarker,
      this.stationMarker,
      this.stationRing,
    );
    this.group.visible = false;
  }

  /** `mapScale` = camera distance in map view, or null to hide the overlay. */
  update(
    s: FlightState,
    zone: LandingZone,
    mapScale: number | null,
    station: { readonly r: readonly [number, number] } | null = null,
  ): void {
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
    const path = s.phase === 'flight' ? orbitPath(el, f.groundAngle, SAMPLES) : [];
    const arr = this.positions.array as Float32Array;
    let n = 0;
    for (const p of path) {
      arr[n * 3] = Math.sin(p.angle) * p.radiusM;
      arr[n * 3 + 1] = Math.cos(p.angle) * p.radiusM;
      arr[n * 3 + 2] = 0;
      n++;
    }
    this.line.geometry.setDrawRange(0, n);
    this.positions.needsUpdate = true;
    this.lineMat.color.set(
      el.status === 'orbit' ? 0x4fd1ff : el.status === 'escape' ? 0xff6bd5 : 0xffa64d,
    );

    const size = mapScale * 0.007;
    this.shipMarker.position.set(s.r[0], s.r[1], 0);
    this.shipMarker.scale.setScalar(size * 1.5);
    const bounded = el.status !== 'escape' && s.phase === 'flight' && el.eccentricity > 0.002;
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

  dispose(): void {
    this.line.geometry.dispose();
    this.lineMat.dispose();
  }
}
