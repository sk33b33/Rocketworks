import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  createConcreteTexture,
  createHazardTexture,
  mulberry32,
} from '../../render/proceduralTextures';
import type { ResourceCache } from '../../render/ResourceCache';

/** Top of the assembly stand; the rocket's root socket sits here. */
export const STAND_HEIGHT_M = 6;

export const HALL = { width: 240, depth: 260, height: 125 } as const;

/*
 * Procedural high-bay assembly hall: floor, walls, columns, roof trusses, bridge crane, service
 * tower with platforms, work lights, tool stations, hangar doors, haze and dust. All original
 * geometry; repeated elements use InstancedMesh.
 */

interface HallParts {
  readonly group: THREE.Group;
  update(deltaSeconds: number, elapsed: number): void;
  dispose(): void;
}

function std(cache: ResourceCache, key: string, params: THREE.MeshStandardMaterialParameters) {
  return cache.material(`hall:${key}`, () => new THREE.MeshStandardMaterial(params));
}

function box(cache: ResourceCache, w: number, h: number, d: number) {
  return cache.geometry(`hall:box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function place(mesh: THREE.Mesh, x: number, y: number, z: number, shadows = false): THREE.Mesh {
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

/** InstancedMesh from a list of transforms. */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: readonly {
    p: [number, number, number];
    r?: [number, number, number];
    s?: [number, number, number];
  }[],
  castShadow = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  transforms.forEach((t, i) => {
    p.set(...t.p);
    q.setFromEuler(e.set(...(t.r ?? [0, 0, 0])));
    s.set(...(t.s ?? [1, 1, 1]));
    mesh.setMatrixAt(i, m.compose(p, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFloor(cache: ResourceCache, group: THREE.Group): void {
  const concrete = cache.texture('hall:concrete', createConcreteTexture);
  const floorGeo = cache.geometry('hall:floor', () => {
    const g = new THREE.PlaneGeometry(HALL.width, HALL.depth).rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getX(i) * HALL.width) / 8, (uv.getY(i) * HALL.depth) / 8);
    return g;
  });
  const floor = new THREE.Mesh(
    floorGeo,
    std(cache, 'floor', { map: concrete, roughness: 0.72, metalness: 0.08 }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  const hazard = cache.texture('hall:hazard', createHazardTexture);
  const hazardMat = std(cache, 'hazard', { map: hazard, roughness: 0.7 });
  const ringGeo = cache.geometry('hall:hazardRing', () => {
    const g = new THREE.RingGeometry(10, 11.5, 96, 1).rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      uv.setXY(i, a * 12, Math.hypot(pos.getX(i), pos.getZ(i)) / 1.5);
    }
    return g;
  });
  group.add(place(new THREE.Mesh(ringGeo, hazardMat), 0, 0.02, 0));

  const lineMat = std(cache, 'paintLine', { color: 0xd9a21b, roughness: 0.6 });
  const line = cache.geometry('hall:line', () =>
    new THREE.PlaneGeometry(0.5, HALL.depth - 20).rotateX(-Math.PI / 2),
  );
  for (const x of [-26, 26]) group.add(place(new THREE.Mesh(line, lineMat), x, 0.02, 0));
}

function buildStand(cache: ResourceCache, group: THREE.Group): void {
  const steel = std(cache, 'standSteel', { color: 0x3c4148, metalness: 0.7, roughness: 0.5 });
  const top = cache.geometry('hall:standTop', () => {
    const g = new THREE.RingGeometry(4.7, 8, 64).rotateX(-Math.PI / 2);
    return g;
  });
  group.add(place(new THREE.Mesh(top, steel), 0, STAND_HEIGHT_M - 0.02, 0, true));
  const side = cache.geometry('hall:standSide', () => {
    const g = new THREE.CylinderGeometry(8, 8, 0.9, 64, 1, true);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i));
    return g;
  });
  const hazard = std(cache, 'hazard', {
    map: cache.texture('hall:hazard', createHazardTexture),
    roughness: 0.7,
  });
  group.add(place(new THREE.Mesh(side, hazard), 0, STAND_HEIGHT_M - 0.45, 0, true));
  const legs = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return {
      p: [7 * Math.cos(a), (STAND_HEIGHT_M - 0.9) / 2, 7 * Math.sin(a)] as [number, number, number],
    };
  });
  group.add(instanced(box(cache, 1.2, STAND_HEIGHT_M - 0.9, 1.2), steel, legs, true));
  const clamps = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return {
      p: [5.2 * Math.cos(a), STAND_HEIGHT_M + 0.3, 5.2 * Math.sin(a)] as [number, number, number],
      r: [0, -a, 0] as [number, number, number],
    };
  });
  group.add(
    instanced(
      box(cache, 1.2, 0.6, 0.8),
      std(cache, 'clamp', { color: 0x9a7b2c, metalness: 0.6, roughness: 0.5 }),
      clamps,
      true,
    ),
  );
}

function buildShell(cache: ResourceCache, group: THREE.Group): void {
  const { width: W, depth: D, height: H } = HALL;
  const wallMat = std(cache, 'wall', { color: 0x30353c, metalness: 0.35, roughness: 0.85 });
  const longWall = cache.geometry('hall:longWall', () => new THREE.PlaneGeometry(D, H));
  const endWall = cache.geometry('hall:endWall', () => new THREE.PlaneGeometry(W, H));
  const left = place(new THREE.Mesh(longWall, wallMat), -W / 2, H / 2, 0);
  left.rotation.y = Math.PI / 2;
  const right = place(new THREE.Mesh(longWall, wallMat), W / 2, H / 2, 0);
  right.rotation.y = -Math.PI / 2;
  const back = place(new THREE.Mesh(endWall, wallMat), 0, H / 2, D / 2);
  back.rotation.y = Math.PI;
  const roof = place(
    new THREE.Mesh(
      cache.geometry('hall:roof', () => new THREE.PlaneGeometry(W, D)),
      wallMat,
    ),
    0,
    H,
    0,
  );
  roof.rotation.x = Math.PI / 2;
  group.add(left, right, back, roof);

  // Structural columns along both long walls and the back wall.
  const colMat = std(cache, 'column', { color: 0x23272d, metalness: 0.6, roughness: 0.6 });
  const cols: { p: [number, number, number] }[] = [];
  for (let z = -D / 2 + 10; z <= D / 2 - 10; z += 20) {
    cols.push({ p: [-W / 2 + 1.5, H / 2, z] }, { p: [W / 2 - 1.5, H / 2, z] });
  }
  for (let x = -W / 2 + 20; x < W / 2; x += 20) cols.push({ p: [x, H / 2, D / 2 - 1.5] });
  group.add(instanced(box(cache, 2.5, H, 2.5), colMat, cols));

  // Horizontal girts give the walls an industrial rhythm.
  const girts: { p: [number, number, number]; r?: [number, number, number] }[] = [];
  for (let y = 15; y < H; y += 18) {
    girts.push(
      { p: [-W / 2 + 0.6, y, 0], r: [0, Math.PI / 2, 0] },
      { p: [W / 2 - 0.6, y, 0], r: [0, Math.PI / 2, 0] },
    );
  }
  group.add(instanced(box(cache, D, 0.6, 0.6), colMat, girts));

  // Roof trusses: chords, posts and diagonals.
  const chords: { p: [number, number, number] }[] = [];
  const posts: { p: [number, number, number] }[] = [];
  const diags: { p: [number, number, number]; r: [number, number, number] }[] = [];
  const trussDepth = 7;
  for (let z = -D / 2 + 20; z < D / 2; z += 20) {
    chords.push({ p: [0, H - 1, z] }, { p: [0, H - 1 - trussDepth, z] });
    for (let x = -W / 2 + 10; x < W / 2; x += 10) {
      posts.push({ p: [x, H - 1 - trussDepth / 2, z] });
      diags.push({
        p: [x + 5, H - 1 - trussDepth / 2, z],
        r: [0, 0, (x / 10) % 2 === 0 ? 0.95 : -0.95],
      });
    }
  }
  group.add(instanced(box(cache, W, 1, 1), colMat, chords));
  group.add(instanced(box(cache, 0.5, trussDepth, 0.5), colMat, posts));
  group.add(instanced(box(cache, 0.4, Math.hypot(10, trussDepth), 0.4), colMat, diags));
}

function buildDoors(cache: ResourceCache, group: THREE.Group): void {
  const { width: W, depth: D, height: H } = HALL;
  const z = -D / 2;
  const doorH = H - 20;
  const doorW = W / 2 - 4;
  const gap = 8; // doors stand slightly open
  const doorMat = std(cache, 'door', { color: 0x4a5058, metalness: 0.55, roughness: 0.6 });
  const door = box(cache, doorW, doorH, 1.5);
  group.add(place(new THREE.Mesh(door, doorMat), -(doorW / 2 + gap / 2), doorH / 2, z + 2));
  group.add(place(new THREE.Mesh(door, doorMat), doorW / 2 + gap / 2, doorH / 2, z + 2));

  // Vertical ribs and a hazard band on each door leaf.
  const ribs: { p: [number, number, number] }[] = [];
  for (const side of [-1, 1]) {
    for (let i = 1; i < 10; i++)
      ribs.push({ p: [side * (gap / 2 + (doorW * i) / 10), doorH / 2, z + 3] });
  }
  group.add(
    instanced(
      box(cache, 0.6, doorH, 0.6),
      std(cache, 'column', { color: 0x23272d, metalness: 0.6, roughness: 0.6 }),
      ribs,
    ),
  );
  const band = cache.geometry('hall:doorBand', () => {
    const g = new THREE.PlaneGeometry(doorW, 3);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * doorW) / 3, uv.getY(i));
    return g;
  });
  const hazard = std(cache, 'hazard', {
    map: cache.texture('hall:hazard', createHazardTexture),
    roughness: 0.7,
  });
  for (const side of [-1, 1])
    group.add(place(new THREE.Mesh(band, hazard), side * (doorW / 2 + gap / 2), 1.6, z + 2.8));

  // Header above the doors and the night sky visible through the gap.
  const header = cache.geometry('hall:doorHeader', () => new THREE.PlaneGeometry(W, H - doorH));
  group.add(
    place(
      new THREE.Mesh(
        header,
        std(cache, 'wall', { color: 0x30353c, metalness: 0.35, roughness: 0.85 }),
      ),
      0,
      doorH + (H - doorH) / 2,
      z,
    ),
  );
  const sky = new THREE.Mesh(
    cache.geometry('hall:sky', () => new THREE.PlaneGeometry(gap + 4, doorH)),
    cache.material('hall:sky', () => new THREE.MeshBasicMaterial({ color: 0x223554, fog: false })),
  );
  group.add(place(sky, 0, doorH / 2, z - 1));
}

function buildTower(cache: ResourceCache, group: THREE.Group): void {
  const x0 = -20;
  const size = 6;
  const height = 98;
  const mat = std(cache, 'tower', { color: 0x2b2f35, metalness: 0.65, roughness: 0.55 });
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({
      p: [x0 + (sx * size) / 2, height / 2, (sz * size) / 2] as [number, number, number],
    })),
  );
  group.add(instanced(box(cache, 0.8, height, 0.8), mat, legs, true));
  const braces: { p: [number, number, number]; r?: [number, number, number] }[] = [];
  for (let y = 4; y < height; y += 6) {
    braces.push({ p: [x0, y, size / 2] }, { p: [x0, y, -size / 2] });
    braces.push(
      { p: [x0 + size / 2, y, 0], r: [0, Math.PI / 2, 0] },
      { p: [x0 - size / 2, y, 0], r: [0, Math.PI / 2, 0] },
    );
  }
  group.add(instanced(box(cache, size, 0.35, 0.35), mat, braces));
  const diag: { p: [number, number, number]; r: [number, number, number] }[] = [];
  for (let y = 7; y < height; y += 6) {
    diag.push(
      { p: [x0, y, size / 2], r: [0, 0, 0.785] },
      { p: [x0, y, -size / 2], r: [0, 0, -0.785] },
    );
  }
  group.add(instanced(box(cache, 0.25, Math.hypot(size, 6), 0.25), mat, diag));

  // Service platforms reaching toward the rocket, with railings and hazard edges.
  const deckMat = std(cache, 'deck', { color: 0x575d66, metalness: 0.5, roughness: 0.7 });
  const railMat = std(cache, 'rail', { color: 0xd9a21b, metalness: 0.3, roughness: 0.5 });
  const decks: { p: [number, number, number] }[] = [];
  const rails: { p: [number, number, number] }[] = [];
  for (const y of [14, 32, 50, 68, 86]) {
    decks.push({ p: [-11.75, y, 0] });
    rails.push({ p: [-11.75, y + 1.1, 3.3] }, { p: [-11.75, y + 1.1, -3.3] });
  }
  group.add(instanced(box(cache, 11.5, 0.4, 6.6), deckMat, decks, true));
  group.add(instanced(box(cache, 11.5, 0.12, 0.12), railMat, rails));
}

function buildCrane(cache: ResourceCache, group: THREE.Group): THREE.Group {
  const { width: W, depth: D, height: H } = HALL;
  const y = H - 14;
  const mat = std(cache, 'crane', { color: 0xc58b16, metalness: 0.4, roughness: 0.5 });
  const railMat = std(cache, 'column', { color: 0x23272d, metalness: 0.6, roughness: 0.6 });
  const rail = box(cache, 1.5, 1.5, D - 10);
  group.add(
    place(new THREE.Mesh(rail, railMat), -W / 2 + 8, y, 0),
    place(new THREE.Mesh(rail, railMat), W / 2 - 8, y, 0),
  );

  const bridge = new THREE.Group();
  bridge.position.set(0, y + 1.5, 40);
  bridge.add(place(new THREE.Mesh(box(cache, W - 16, 3, 2.5), mat), 0, 0, -2));
  bridge.add(place(new THREE.Mesh(box(cache, W - 16, 3, 2.5), mat), 0, 0, 2));
  bridge.add(
    place(
      new THREE.Mesh(
        box(cache, 6, 2.5, 7),
        std(cache, 'trolley', { color: 0x3a3e45, metalness: 0.6, roughness: 0.5 }),
      ),
      35,
      1.5,
      0,
    ),
  );
  const cable = new THREE.Mesh(
    cache.geometry('hall:cable', () => new THREE.CylinderGeometry(0.08, 0.08, 30, 6)),
    std(cache, 'cable', { color: 0x111111, roughness: 0.4 }),
  );
  bridge.add(place(cable, 35, -15, 0));
  bridge.add(place(new THREE.Mesh(box(cache, 1.6, 2.2, 1.6), mat), 35, -31, 0));
  group.add(bridge);
  return bridge;
}

function buildLights(cache: ResourceCache, group: THREE.Group): void {
  const { height: H } = HALL;
  group.add(new THREE.HemisphereLight(0xb8c4d4, 0x2a2420, 0.55));

  const key = new THREE.DirectionalLight(0xfff0dc, 1.7);
  key.position.set(45, 150, 70);
  key.target.position.set(0, 35, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -55;
  key.shadow.camera.right = 55;
  key.shadow.camera.top = 75;
  key.shadow.camera.bottom = -45;
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 320;
  key.shadow.bias = -0.0004;
  group.add(key, key.target);

  // Warm work lights aimed at the build area, plus subtle haze shafts.
  const shaftMat = cache.material(
    'hall:shaft',
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
  );
  const shaft = cache.geometry(
    'hall:shaftGeo',
    () => new THREE.CylinderGeometry(1.5, 16, 95, 24, 1, true),
  );
  for (const [x, z] of [
    [-45, 40],
    [45, 40],
    [45, -40],
    [-45, -40],
  ] as const) {
    const spot = new THREE.SpotLight(0xffd8a8, 2.2, 0, 0.42, 0.6, 0);
    spot.position.set(x, H - 10, z);
    spot.target.position.set(0, 30, 0);
    group.add(spot, spot.target);
    const cone = new THREE.Mesh(shaft, shaftMat);
    const dir = new THREE.Vector3(-x, 30 - (H - 10), -z).normalize();
    cone.position.set(x, H - 10, z).addScaledVector(dir, 47.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    group.add(cone);
  }

  // Ceiling light fixtures (emissive only; lighting comes from the lights above).
  const fixtures: { p: [number, number, number] }[] = [];
  for (let x = -90; x <= 90; x += 30)
    for (let z = -100; z <= 100; z += 40) fixtures.push({ p: [x, H - 9, z] });
  group.add(
    instanced(
      box(cache, 5, 0.4, 1.6),
      cache.material('hall:fixture', () => new THREE.MeshBasicMaterial({ color: 0xfff1d6 })),
      fixtures,
    ),
  );
}

function buildWorkshop(cache: ResourceCache, group: THREE.Group): void {
  const rand = mulberry32(99);
  const benchMat = std(cache, 'bench', { color: 0x5d646d, metalness: 0.5, roughness: 0.6 });
  const cabinetMat = std(cache, 'cabinet', { color: 0x9b2c22, metalness: 0.3, roughness: 0.55 });
  const crateMat = std(cache, 'crate', { color: 0x6a5a3e, roughness: 0.9 });
  const tankMat = std(cache, 'gasTank', { color: 0x2f6f4f, metalness: 0.4, roughness: 0.5 });

  const benches: { p: [number, number, number]; r: [number, number, number] }[] = [];
  const cabinets: { p: [number, number, number]; r: [number, number, number] }[] = [];
  const crates: { p: [number, number, number]; r: [number, number, number] }[] = [];
  const tanks: { p: [number, number, number] }[] = [];
  // Tool stations on a ring around the build area, leaving the tower side and door aisle clear.
  for (const angle of [20, 55, 95, 130, 230, 265, 300, 335]) {
    const a = (angle * Math.PI) / 180;
    const r = 34 + rand() * 8;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    const facing: [number, number, number] = [0, -a + Math.PI / 2, 0];
    benches.push({ p: [x, 0.5, z], r: facing });
    cabinets.push({
      p: [x + 3.5 * Math.cos(a + 1.6), 1.1, z + 3.5 * Math.sin(a + 1.6)],
      r: facing,
    });
    crates.push({
      p: [x + 5 * Math.cos(a - 1.4), 0.75, z + 5 * Math.sin(a - 1.4)],
      r: [0, rand() * 3, 0],
    });
    for (let k = 0; k < 3; k++)
      tanks.push({ p: [x - 2 * Math.cos(a) + k * 0.6, 0.8, z - 2 * Math.sin(a)] });
  }
  group.add(instanced(box(cache, 4, 1, 1.6), benchMat, benches, true));
  group.add(instanced(box(cache, 1.2, 2.2, 0.8), cabinetMat, cabinets, true));
  group.add(instanced(box(cache, 1.5, 1.5, 1.5), crateMat, crates, true));
  group.add(
    instanced(
      cache.geometry('hall:gasTank', () => new THREE.CylinderGeometry(0.25, 0.25, 1.6, 12)),
      tankMat,
      tanks,
      true,
    ),
  );
}

function buildDust(cache: ResourceCache, group: THREE.Group): THREE.Points {
  const geo = cache.geometry('hall:dust', () => {
    const rand = mulberry32(5);
    const positions = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      positions[i * 3] = (rand() - 0.5) * 130;
      positions[i * 3 + 1] = rand() * 105;
      positions[i * 3 + 2] = (rand() - 0.5) * 130;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  });
  const mat = cache.material(
    'hall:dustMat',
    () =>
      new THREE.PointsMaterial({
        color: 0xffe6bf,
        size: 0.18,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
  );
  const points = new THREE.Points(geo, mat);
  group.add(points);
  return points;
}

/** Builds the hall into the scene, sets fog/background/environment, and returns an updater. */
export function buildAssemblyHall(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  cache: ResourceCache,
): HallParts {
  const group = new THREE.Group();
  group.name = 'assembly-hall';
  scene.background = new THREE.Color(0x131518);
  scene.fog = new THREE.Fog(0x16181c, 140, 380);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.55;

  buildFloor(cache, group);
  buildStand(cache, group);
  buildShell(cache, group);
  buildDoors(cache, group);
  buildTower(cache, group);
  const crane = buildCrane(cache, group);
  buildLights(cache, group);
  buildWorkshop(cache, group);
  const dust = buildDust(cache, group);
  scene.add(group);

  return {
    group,
    update(deltaSeconds, elapsed) {
      crane.position.z = 40 + Math.sin(elapsed * 0.05) * 25;
      dust.rotation.y += deltaSeconds * 0.01;
      dust.position.y = Math.sin(elapsed * 0.2) * 0.6;
    },
    dispose() {
      group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      envTarget.dispose();
      scene.environment = null;
      scene.remove(group);
    },
  };
}
