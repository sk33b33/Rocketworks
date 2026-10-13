import * as THREE from 'three';
import type { FlightState } from '../../flight/flightModel';
import type { LandingZone } from '../../flight/landingZones';
import { localFrame, orbitalElements, orbitPath } from '../../flight/orbitMath';
import type { ResourceCache } from '../../render/ResourceCache';
import { EARTH_RADIUS_M } from '../../simulation/constants';

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
    for (const m of [this.apo, this.peri, this.shipMarker]) m.renderOrder = 3;
    this.group.add(this.line, this.apo, this.peri, this.shipMarker);
    this.group.visible = false;
  }

  /** `mapScale` = camera distance in map view, or null to hide the overlay. */
  update(s: FlightState, zone: LandingZone, mapScale: number | null): void {
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
