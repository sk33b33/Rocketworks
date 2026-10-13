import * as THREE from 'three';
import { createConcreteTexture, createHazardTexture } from '../../render/proceduralTextures';
import type { ResourceCache } from '../../render/ResourceCache';
import { mulberry32 } from '../../shared/random';

/*
 * Procedural coastal launch site: orbital launch mount over a flame trench, integration tower
 * with catch arms and a quick-disconnect arm, tank farm, roads, perimeter fence, dunes/hills and
 * the sea to the east (+X, the launch direction). Original geometry only.
 */

/** Height of the mount's top ring, where the rocket's base sits. */
export const MOUNT_TOP_M = 22;
export const TOWER_X_M = -30;
export const ROLLOUT_START_X_M = -650;
export const DECK_HEIGHT_M = 6;

export interface LaunchSite {
  readonly group: THREE.Group;
  /** Quick-disconnect arm pivot (rotates away at tower clearance). */
  readonly qdArm: THREE.Object3D;
  /** Catch arms carriage (moves with the rocket during stacking). */
  readonly catchArms: THREE.Object3D;
  readonly transporter: THREE.Object3D;
  readonly sun: THREE.DirectionalLight;
}

function std(cache: ResourceCache, key: string, p: THREE.MeshStandardMaterialParameters) {
  return cache.material(`site:${key}`, () => new THREE.MeshStandardMaterial(p));
}

function box(cache: ResourceCache, w: number, h: number, d: number) {
  return cache.geometry(`site:box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  items: { p: [number, number, number]; r?: [number, number, number] }[],
  shadow = false,
) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  items.forEach((it, i) => {
    q.setFromEuler(e.set(...(it.r ?? [0, 0, 0])));
    im.setMatrixAt(i, m.compose(new THREE.Vector3(...it.p), q, one));
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = shadow;
  im.receiveShadow = true;
  return im;
}

function buildGround(cache: ResourceCache, g: THREE.Group): void {
  const ground = mesh(
    cache.geometry('site:ground', () => new THREE.CircleGeometry(30_000, 96).rotateX(-Math.PI / 2)),
    std(cache, 'ground', { color: 0x8a8462, roughness: 1 }),
    0,
    -0.05,
    0,
    false,
  );
  g.add(ground);
  // Sea to the east, beyond the beach.
  const sea = mesh(
    cache.geometry('site:sea', () => new THREE.PlaneGeometry(60_000, 60_000).rotateX(-Math.PI / 2)),
    std(cache, 'sea', { color: 0x1e4f6e, roughness: 0.25, metalness: 0.3 }),
    30_000 + 700,
    0.02,
    0,
    false,
  );
  g.add(sea);
  const beach = mesh(
    cache.geometry('site:beach', () => new THREE.PlaneGeometry(260, 60_000).rotateX(-Math.PI / 2)),
    std(cache, 'beach', { color: 0xd8c89a, roughness: 1 }),
    600,
    0.01,
    0,
    false,
  );
  g.add(beach);

  const concrete = cache.texture('site:concrete', createConcreteTexture);
  const padGeo = cache.geometry('site:pad', () => {
    const geo = new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 22, uv.getY(i) * 22);
    return geo;
  });
  g.add(
    mesh(padGeo, std(cache, 'padConcrete', { map: concrete, roughness: 0.85 }), 0, 0.03, 0, false),
  );

  const roadMat = std(cache, 'road', { color: 0x2c2d30, roughness: 0.95 });
  const road = cache.geometry('site:road', () =>
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  );
  const addRoad = (x: number, z: number, w: number, d: number) => {
    const r = mesh(road, roadMat, x, 0.04, z, false);
    r.scale.set(w, 1, d);
    g.add(r);
  };
  addRoad(-400, 0, 520, 18); // rollout road from the factory (west)
  addRoad(-150, 90, 18, 160); // to the tank farm
  addRoad(-60, 170, 300, 12);
}

function buildMount(cache: ResourceCache, g: THREE.Group): void {
  const steel = std(cache, 'mountSteel', { color: 0x5b636d, metalness: 0.7, roughness: 0.45 });
  const concreteMat = std(cache, 'mountConcrete', { color: 0x9a978f, roughness: 0.9 });
  // Six concrete legs and a steel table ring with a hole for the engines.
  const legs = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return {
      p: [11 * Math.cos(a), (MOUNT_TOP_M - 3) / 2, 11 * Math.sin(a)] as [number, number, number],
    };
  });
  g.add(instanced(box(cache, 3, MOUNT_TOP_M - 3, 3), concreteMat, legs, true));
  const table = mesh(
    cache.geometry('site:mountTable', () => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 13, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, 5.6, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, {
        depth: 3,
        bevelEnabled: false,
        curveSegments: 48,
      }).rotateX(Math.PI / 2);
    }),
    steel,
    0,
    MOUNT_TOP_M,
    0,
  );
  g.add(table);
  const clamps = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return {
      p: [5.9 * Math.cos(a), MOUNT_TOP_M + 0.4, 5.9 * Math.sin(a)] as [number, number, number],
      r: [0, -a, 0] as [number, number, number],
    };
  });
  g.add(
    instanced(
      box(cache, 1.2, 0.8, 0.9),
      std(cache, 'clamp', { color: 0x9a7b2c, metalness: 0.6, roughness: 0.5 }),
      clamps,
    ),
  );
  // Flame trench and deflector under the mount.
  g.add(
    mesh(
      box(cache, 26, 1, 70),
      std(cache, 'trench', { color: 0x1b1c1e, roughness: 1 }),
      0,
      -0.45,
      20,
      false,
    ),
  );
  const deflector = mesh(
    cache.geometry('site:deflector', () => new THREE.ConeGeometry(7, 3, 4).rotateY(Math.PI / 4)),
    std(cache, 'deflector', { color: 0x3b3e42, metalness: 0.6, roughness: 0.5 }),
    0,
    1.5,
    0,
  );
  g.add(deflector);
  // Hazard ring on the pad.
  const hazard = cache.texture('site:hazard', createHazardTexture);
  const ring = mesh(
    cache.geometry('site:hazardRing', () => {
      const geo = new THREE.RingGeometry(16, 17.5, 96).rotateX(-Math.PI / 2);
      const uv = geo.getAttribute('uv');
      const pos = geo.getAttribute('position');
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, Math.atan2(pos.getZ(i), pos.getX(i)) * 14, 0.5);
      return geo;
    }),
    std(cache, 'hazard', { map: hazard, roughness: 0.8 }),
    0,
    0.06,
    0,
    false,
  );
  g.add(ring);
}

function buildTower(
  cache: ResourceCache,
  g: THREE.Group,
): { qdArm: THREE.Object3D; catchArms: THREE.Object3D } {
  const height = 146;
  const size = 9;
  const mat = std(cache, 'tower', { color: 0x30353b, metalness: 0.65, roughness: 0.55 });
  const x0 = TOWER_X_M;
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({
      p: [x0 + (sx * size) / 2, height / 2, (sz * size) / 2] as [number, number, number],
    })),
  );
  g.add(instanced(box(cache, 1.2, height, 1.2), mat, legs, true));
  const braces: { p: [number, number, number]; r?: [number, number, number] }[] = [];
  const diags: { p: [number, number, number]; r: [number, number, number] }[] = [];
  for (let y = 6; y < height; y += 7) {
    braces.push({ p: [x0, y, size / 2] }, { p: [x0, y, -size / 2] });
    braces.push(
      { p: [x0 + size / 2, y, 0], r: [0, Math.PI / 2, 0] },
      { p: [x0 - size / 2, y, 0], r: [0, Math.PI / 2, 0] },
    );
    diags.push(
      { p: [x0, y + 3.5, size / 2], r: [0, 0, 0.9] },
      { p: [x0, y + 3.5, -size / 2], r: [0, 0, -0.9] },
    );
  }
  g.add(instanced(box(cache, size, 0.5, 0.5), mat, braces));
  g.add(instanced(box(cache, 0.35, Math.hypot(size, 7), 0.35), mat, diags));
  g.add(mesh(box(cache, size + 2, 3, size + 2), mat, x0, height + 1.5, 0));

  // Catch arms ("chopsticks") on a carriage that moves up and down the tower.
  const catchArms = new THREE.Group();
  catchArms.position.set(x0 + size / 2, 90, 0);
  const armMat = std(cache, 'arms', { color: 0x6c7480, metalness: 0.6, roughness: 0.45 });
  catchArms.add(mesh(box(cache, 3, 4, size + 1), mat, 1.5, 0, 0));
  for (const side of [-1, 1]) {
    const arm = mesh(box(cache, 28, 2.2, 1.6), armMat, 14, 0, side * 6.2);
    arm.rotation.y = side * 0.08;
    catchArms.add(arm);
  }
  g.add(catchArms);

  // Quick-disconnect arm reaching the ship; swings away at tower clearance.
  const qdArm = new THREE.Group();
  qdArm.position.set(x0 + size / 2, 66, -2);
  qdArm.add(mesh(box(cache, 22, 2.4, 2.4), armMat, 11, 0, 0));
  qdArm.add(
    mesh(
      box(cache, 2, 4, 3.2),
      std(cache, 'qdPlate', { color: 0xd9a21b, metalness: 0.4, roughness: 0.5 }),
      22,
      0,
      0,
    ),
  );
  g.add(qdArm);
  return { qdArm, catchArms };
}

function buildTankFarm(cache: ResourceCache, g: THREE.Group): void {
  const white = std(cache, 'tankWhite', { color: 0xe6e8ea, metalness: 0.3, roughness: 0.45 });
  const vertical = cache.geometry('site:vtank', () => new THREE.CylinderGeometry(4.2, 4.2, 30, 32));
  const horizontal = cache.geometry('site:htank', () =>
    new THREE.CapsuleGeometry(3, 26, 6, 20).rotateZ(Math.PI / 2),
  );
  const vItems: { p: [number, number, number] }[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 2; j++) vItems.push({ p: [-170 + i * 12, 15, 120 + j * 12] });
  g.add(instanced(vertical, white, vItems, true));
  const hItems: { p: [number, number, number] }[] = [];
  for (let i = 0; i < 4; i++) hItems.push({ p: [-120, 4, 105 + i * 9] });
  g.add(
    instanced(
      horizontal,
      std(cache, 'tankSilver', { color: 0xb9bec4, metalness: 0.8, roughness: 0.35 }),
      hItems,
      true,
    ),
  );
  // Pipe rack to the mount.
  const pipeMat = std(cache, 'pipe', { color: 0x7b8088, metalness: 0.8, roughness: 0.4 });
  const pipe = cache.geometry('site:pipe', () =>
    new THREE.CylinderGeometry(0.6, 0.6, 1, 10).rotateZ(Math.PI / 2),
  );
  const rack = mesh(pipe, pipeMat, -80, 2, 60);
  rack.scale.set(150, 1, 1);
  rack.rotation.y = 0.55;
  g.add(rack);
}

function buildPerimeterAndHills(cache: ResourceCache, g: THREE.Group): void {
  const posts: { p: [number, number, number] }[] = [];
  for (let i = -300; i <= 300; i += 12) {
    posts.push({ p: [i, 1.2, -300] }, { p: [i, 1.2, 300] }, { p: [-300, 1.2, i] });
  }
  g.add(
    instanced(
      box(cache, 0.25, 2.4, 0.25),
      std(cache, 'fence', { color: 0x9aa0a6, metalness: 0.5, roughness: 0.6 }),
      posts,
    ),
  );
  // Low dunes and distant hills to the west, north and south (procedural ring).
  const hills = mesh(
    cache.geometry('site:hills', () => {
      const geo = new THREE.RingGeometry(2_500, 9_000, 160, 6).rotateX(-Math.PI / 2);
      const pos = geo.getAttribute('position');
      const rand = mulberry32(11);
      const bumps = Array.from({ length: 12 }, () => ({
        a: rand() * Math.PI * 2,
        h: 80 + rand() * 260,
        w: 0.2 + rand() * 0.4,
      }));
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const a = Math.atan2(z, x);
        if (Math.cos(a) > 0.3) continue; // keep the sea side flat
        const r = Math.hypot(x, z);
        const edge = Math.sin(((r - 2_500) / 6_500) * Math.PI);
        let h = 0;
        for (const b of bumps)
          h += b.h * Math.exp(-Math.pow(Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a)) / b.w, 2));
        pos.setY(i, h * edge);
      }
      geo.computeVertexNormals();
      return geo;
    }),
    std(cache, 'hills', { color: 0x6f6d52, roughness: 1 }),
    0,
    0,
    0,
    false,
  );
  g.add(hills);
}

function buildTransporter(cache: ResourceCache): THREE.Group {
  const t = new THREE.Group();
  const body = std(cache, 'transporter', { color: 0xd9a21b, metalness: 0.4, roughness: 0.55 });
  t.add(mesh(box(cache, 18, 3, 9), body, 0, DECK_HEIGHT_M - 1.5, 0));
  t.add(
    mesh(
      box(cache, 13, 0.6, 13),
      std(cache, 'deck', { color: 0x4a4f56, metalness: 0.6, roughness: 0.5 }),
      0,
      DECK_HEIGHT_M - 0.3,
      0,
    ),
  );
  const wheels: { p: [number, number, number]; r: [number, number, number] }[] = [];
  for (let i = -3; i <= 3; i++)
    for (const z of [-4.6, 4.6]) wheels.push({ p: [i * 2.4, 1.2, z], r: [Math.PI / 2, 0, 0] });
  t.add(
    instanced(
      cache.geometry('site:wheel', () => new THREE.CylinderGeometry(1.2, 1.2, 1, 16)),
      std(cache, 'tyre', { color: 0x151515, roughness: 0.9 }),
      wheels,
      true,
    ),
  );
  return t;
}

export function buildLaunchSite(scene: THREE.Scene, cache: ResourceCache): LaunchSite {
  const g = new THREE.Group();
  g.name = 'launch-site';
  buildGround(cache, g);
  buildMount(cache, g);
  const { qdArm, catchArms } = buildTower(cache, g);
  buildTankFarm(cache, g);
  buildPerimeterAndHills(cache, g);
  const transporter = buildTransporter(cache);
  g.add(transporter);

  g.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b6248, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-300, 500, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -160;
  sc.right = 160;
  sc.top = 200;
  sc.bottom = -60;
  sc.near = 10;
  sc.far = 1400;
  sun.shadow.bias = -0.0005;
  g.add(sun, sun.target);
  scene.add(g);
  return { group: g, qdArm, catchArms, transporter, sun };
}
