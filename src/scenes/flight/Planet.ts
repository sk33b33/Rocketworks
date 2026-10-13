import * as THREE from 'three';
import { LANDING_ZONES, type LandingZone } from '../../flight/landingZones';
import { isLand } from '../../flight/landingZones';
import type { ResourceCache } from '../../render/ResourceCache';
import { mulberry32 } from '../../shared/random';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { createCloudTexture, createEarthTexture } from './earthTextures';

/*
 * Earth-attached visuals. Everything lives in `group`, which the scene positions at the Earth's
 * centre relative to the ship (floating origin), so vertex coordinates stay small enough for
 * float32 precision near the camera. Render order: stars → Earth → clouds → atmosphere →
 * surface tile → ship/props.
 */

const Y = new THREE.Vector3(0, 1, 0);
const CLOUD_ALT_M = 9_000;
const ATMO_ALT_M = 70_000;
/** The local surface tile (and zone props) only show near the ground. */
const LOCAL_SURFACE_ALT_M = 45_000;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSun;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
  float lit = clamp(dot(vNormal, uSun) * 0.8 + 0.35, 0.0, 1.0);
  gl_FragColor = vec4(uColor * rim * lit * 1.6, rim * lit);
}`;

/** Ground-angle placement helpers (simulation plane = scene XY plane). */
export function upAt(groundAngle: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(groundAngle), Math.cos(groundAngle), 0);
}

export class Planet {
  readonly group = new THREE.Group();
  readonly earth: THREE.Mesh;
  private readonly clouds: THREE.Mesh;
  private readonly atmosphere: THREE.Mesh;
  private readonly atmoMat: THREE.ShaderMaterial;
  readonly stars: THREE.Points;
  private readonly tile: THREE.Mesh;
  private readonly tileOcean: THREE.Material;
  private readonly tileLand: THREE.Material;
  private readonly props = new Map<string, THREE.Object3D>();
  private readonly targetRing: THREE.Mesh;
  private readonly mapMarkers = new Map<string, THREE.Mesh>();

  constructor(cache: ResourceCache) {
    const earthTex = cache.texture('flight:earthTex', () => createEarthTexture());
    const cloudTex = cache.texture('flight:cloudTex', () => createCloudTexture());
    // Sphere pole along +Z so the texture equator lies in the orbital (XY) plane.
    this.earth = new THREE.Mesh(
      cache.geometry('flight:earth', () =>
        new THREE.SphereGeometry(EARTH_RADIUS_M, 192, 96).rotateX(Math.PI / 2),
      ),
      cache.material(
        'flight:earthMat',
        () =>
          // No depth writes: the planet is a backdrop painted first, so the cloud and
          // atmosphere shells never z-fight with it at orbital distances.
          new THREE.MeshStandardMaterial({
            map: earthTex,
            roughness: 0.85,
            metalness: 0,
            depthWrite: false,
          }),
      ),
    );
    this.earth.renderOrder = -3;
    this.clouds = new THREE.Mesh(
      cache.geometry('flight:clouds', () =>
        new THREE.SphereGeometry(EARTH_RADIUS_M + CLOUD_ALT_M, 128, 64).rotateX(Math.PI / 2),
      ),
      cache.material(
        'flight:cloudMat',
        () =>
          new THREE.MeshStandardMaterial({
            map: cloudTex,
            transparent: true,
            depthWrite: false,
            roughness: 1,
          }),
      ),
    );
    this.clouds.renderOrder = -2.6;
    this.atmoMat = cache.material(
      'flight:atmoMat',
      () =>
        new THREE.ShaderMaterial({
          vertexShader: ATMO_VERT,
          fragmentShader: ATMO_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(0x5aa0ff) },
            uSun: { value: new THREE.Vector3(1, 0, 0) },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
    );
    this.atmosphere = new THREE.Mesh(
      cache.geometry(
        'flight:atmo',
        () => new THREE.SphereGeometry(EARTH_RADIUS_M + ATMO_ALT_M, 128, 64),
      ),
      this.atmoMat,
    );
    this.atmosphere.renderOrder = -2.4;

    // Local ground under the ship (flat disc, precise near the camera).
    this.tileOcean = cache.material(
      'flight:tileOcean',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x123a63,
          roughness: 0.35,
          metalness: 0.1,
          depthTest: false,
        }),
    );
    this.tileLand = cache.material(
      'flight:tileLand',
      () => new THREE.MeshStandardMaterial({ color: 0x6f7a52, roughness: 0.95, depthTest: false }),
    );
    this.tile = new THREE.Mesh(
      cache.geometry('flight:tile', () =>
        new THREE.CircleGeometry(90_000, 96).rotateX(-Math.PI / 2),
      ),
      this.tileOcean,
    );
    this.tile.renderOrder = -2;
    this.tile.visible = false;

    this.targetRing = new THREE.Mesh(
      cache.geometry('flight:ring', () =>
        new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2),
      ),
      cache.material(
        'flight:ringMat',
        () =>
          new THREE.MeshBasicMaterial({
            color: 0x3aa6cc,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false,
          }),
      ),
    );
    // Painted on the ground just after the surface tile, before the ship and props.
    this.targetRing.renderOrder = -1.9;
    this.targetRing.visible = false;

    this.stars = buildStars(cache);
    this.group.add(this.earth, this.clouds, this.atmosphere, this.tile, this.targetRing);
    for (const z of LANDING_ZONES) {
      const prop = buildZoneProp(z, cache);
      if (prop) {
        // Deck tops sit at the surface where the simulation touches down.
        placeOnSurface(prop, z.groundAngle, z.kind === 'platform' ? -2 : -1);
        prop.visible = false;
        this.props.set(z.id, prop);
        this.group.add(prop);
      }
      const marker = new THREE.Mesh(
        cache.geometry('flight:marker', () => new THREE.SphereGeometry(1, 16, 12)),
        cache.material(
          `flight:marker:${z.kind}`,
          () =>
            new THREE.MeshBasicMaterial({
              color: z.kind === 'splash' ? 0x4fd1ff : z.kind === 'platform' ? 0xffc04d : 0x7dff9a,
              // Transparent pass so map markers draw above the cloud layer.
              transparent: true,
              depthTest: false,
              fog: false,
            }),
        ),
      );
      marker.renderOrder = 2;
      placeOnSurface(marker, z.groundAngle, 0);
      marker.visible = false;
      this.mapMarkers.set(z.id, marker);
      this.group.add(marker);
    }
  }

  /**
   * Per-frame update. `centre` = Earth centre relative to the ship; `shipAngle`/`shipAltM` place
   * the local tile; `mapScale` (camera distance) sizes map markers, or null outside the map.
   */
  update(
    centre: THREE.Vector3,
    shipAngle: number,
    shipAltM: number,
    camAltM: number,
    sunDir: THREE.Vector3,
    zone: LandingZone,
    mapScale: number | null,
  ): void {
    this.group.position.copy(centre);
    this.clouds.visible = camAltM > CLOUD_ALT_M + 4_000;
    this.atmosphere.visible = camAltM > ATMO_ALT_M * 0.6;
    (this.atmoMat.uniforms.uSun!.value as THREE.Vector3).copy(sunDir);

    const near = shipAltM < LOCAL_SURFACE_ALT_M && mapScale === null;
    this.tile.visible = near;
    if (near) {
      placeOnSurface(this.tile, shipAngle, 0);
      this.tile.material = isLand(shipAngle) ? this.tileLand : this.tileOcean;
    }
    for (const [id, prop] of this.props)
      prop.visible =
        near &&
        Math.abs(shipAngle - (LANDING_ZONES.find((z) => z.id === id)?.groundAngle ?? 99)) < 0.05;
    // Target ring: shows the selected zone's tolerance on approach.
    this.targetRing.visible = near || mapScale !== null;
    placeOnSurface(this.targetRing, zone.groundAngle, 2);
    const ringR = Math.max(zone.toleranceM, mapScale !== null ? mapScale * 0.012 : 0);
    this.targetRing.scale.set(ringR, 1, ringR);
    for (const m of this.mapMarkers.values()) {
      m.visible = mapScale !== null;
      if (mapScale !== null) m.scale.setScalar(mapScale * 0.006);
    }
  }
}

/** Puts an object on the surface at a ground angle with its +Y along the local vertical. */
export function placeOnSurface(o: THREE.Object3D, groundAngle: number, heightM: number): void {
  const up = upAt(groundAngle);
  o.position.copy(up).multiplyScalar(EARTH_RADIUS_M + heightM);
  o.quaternion.setFromUnitVectors(Y, up);
}

function buildStars(cache: ResourceCache): THREE.Points {
  const stars = new THREE.Points(
    cache.geometry('flight:stars', () => {
      const rand = mulberry32(11);
      const n = 2_500;
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        pos.set([s * Math.cos(a), u, s * Math.sin(a)], i * 3);
        const b = 0.45 + rand() * 0.55;
        const warm = rand();
        col.set([b, b * (0.9 + warm * 0.1), b * (0.85 + (1 - warm) * 0.15)], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    }),
    cache.material(
      'flight:starMat',
      () =>
        new THREE.PointsMaterial({
          size: 1.7,
          sizeAttenuation: false,
          vertexColors: true,
          depthWrite: false,
          depthTest: false,
          fog: false,
        }),
    ),
  );
  stars.renderOrder = -10;
  stars.frustumCulled = false;
  return stars;
}

/** Simple original props for the precision landing zones (none for the open-ocean zone). */
function buildZoneProp(zone: LandingZone, cache: ResourceCache): THREE.Object3D | null {
  const steel = cache.material(
    'flight:propSteel',
    () => new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.6 }),
  );
  const deck = cache.material(
    'flight:propDeck',
    () => new THREE.MeshStandardMaterial({ color: 0x585d63, roughness: 0.85, metalness: 0.2 }),
  );
  const paint = cache.material(
    'flight:propPaint',
    () => new THREE.MeshBasicMaterial({ color: 0xf2c230, fog: false }),
  );
  const g = new THREE.Group();
  if (zone.kind === 'platform') {
    const hull = new THREE.Mesh(
      cache.geometry('flight:platHull', () => new THREE.BoxGeometry(110, 8, 80)),
      steel,
    );
    hull.position.y = -3;
    const top = new THREE.Mesh(
      cache.geometry('flight:platDeck', () => new THREE.BoxGeometry(100, 1, 72)),
      deck,
    );
    top.position.y = 1.5;
    const ring = new THREE.Mesh(
      cache.geometry('flight:platRing', () =>
        new THREE.RingGeometry(16, 19, 48).rotateX(-Math.PI / 2),
      ),
      paint,
    );
    ring.position.y = 2.05;
    g.add(hull, top, ring);
    for (const x of [-48, 48]) {
      const mast = new THREE.Mesh(
        cache.geometry('flight:platMast', () => new THREE.BoxGeometry(2, 14, 2)),
        steel,
      );
      mast.position.set(x, 9, -32);
      g.add(mast);
    }
    return g;
  }
  if (zone.kind === 'pad') {
    const pad = new THREE.Mesh(
      cache.geometry('flight:pad', () => new THREE.CylinderGeometry(60, 64, 2, 48)),
      deck,
    );
    const ring = new THREE.Mesh(
      cache.geometry('flight:padRing', () =>
        new THREE.RingGeometry(20, 24, 48).rotateX(-Math.PI / 2),
      ),
      paint,
    );
    ring.position.y = 1.05;
    g.add(pad, ring);
    return g;
  }
  return null;
}
