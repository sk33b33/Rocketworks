import * as THREE from 'three';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import type { ResourceCache } from '../../render/ResourceCache';
import { mulberry32 } from '../../shared/random';

/*
 * Mapping from the 2D simulation (downrange, altitude) to the 3D scene. The pad is at the origin
 * with +X pointing downrange (east) and the Earth's centre at (0, -R, 0), so the vehicle follows
 * the planet's curvature and its local "up" tilts by the travelled angle.
 */

export interface PolarPlacement {
  readonly x: number;
  readonly y: number;
  /** Angle travelled around the Earth (radians); rotates the local vertical. */
  readonly arcRad: number;
}

export function placeOnEarth(downrangeM: number, altitudeM: number): PolarPlacement {
  const arcRad = downrangeM / EARTH_RADIUS_M;
  const r = EARTH_RADIUS_M + altitudeM;
  return { x: r * Math.sin(arcRad), y: r * Math.cos(arcRad) - EARTH_RADIUS_M, arcRad };
}

/** Z-rotation for a vehicle whose thrust points `elevationDeg` above the local horizon. */
export function vehicleRoll(elevationDeg: number, arcRad: number): number {
  return -((90 - elevationDeg) * Math.PI) / 180 - arcRad;
}

const SKY_LOW = new THREE.Color(0x8cbbe6);
const SKY_MID = new THREE.Color(0x2c5a9a);
const SPACE = new THREE.Color(0x02040a);

/** Sky colour fading from daytime blue to black between the ground and ~70 km. */
export function skyColor(altitudeM: number, out = new THREE.Color()): THREE.Color {
  const t = Math.min(1, Math.max(0, altitudeM / 70_000));
  if (t < 0.35) return out.copy(SKY_LOW).lerp(SKY_MID, t / 0.35);
  return out.copy(SKY_MID).lerp(SPACE, (t - 0.35) / 0.65);
}

export interface SpaceBackdrop {
  readonly earth: THREE.Mesh;
  readonly atmosphere: THREE.Mesh;
  readonly stars: THREE.Points;
}

/** Earth sphere, a thin atmosphere shell and a star field (shown at altitude). */
export function buildSpaceBackdrop(scene: THREE.Scene, cache: ResourceCache): SpaceBackdrop {
  const earth = new THREE.Mesh(
    cache.geometry('space:earth', () => new THREE.SphereGeometry(EARTH_RADIUS_M - 30, 128, 96)),
    cache.material(
      'space:earthMat',
      () => new THREE.MeshStandardMaterial({ color: 0x2b5f8c, roughness: 0.75, metalness: 0.05 }),
    ),
  );
  earth.position.set(0, -EARTH_RADIUS_M, 0);
  earth.visible = false;
  const atmosphere = new THREE.Mesh(
    cache.geometry('space:atmo', () => new THREE.SphereGeometry(EARTH_RADIUS_M + 80_000, 96, 64)),
    cache.material(
      'space:atmoMat',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0x6fb0ff,
          transparent: true,
          opacity: 0.18,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
    ),
  );
  atmosphere.position.copy(earth.position);
  atmosphere.visible = false;
  const stars = new THREE.Points(
    cache.geometry('space:stars', () => {
      const rand = mulberry32(3);
      const n = 1500;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        pos.set([s * Math.cos(a) * 900_000, u * 900_000, s * Math.sin(a) * 900_000], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return geo;
    }),
    cache.material(
      'space:starMat',
      () =>
        new THREE.PointsMaterial({
          color: 0xffffff,
          size: 1.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
        }),
    ),
  );
  stars.frustumCulled = false;
  scene.add(earth, atmosphere, stars);
  return { earth, atmosphere, stars };
}
