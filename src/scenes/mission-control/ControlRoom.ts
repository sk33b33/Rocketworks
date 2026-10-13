import * as THREE from 'three';
import type { ResourceCache } from '../../render/ResourceCache';

/*
 * Procedural mission control room: tiered console rows facing a wall of displays, ceiling light
 * strips, carpeted floor and a glass viewing gallery at the back. Original geometry only.
 */

export const ROOM = { width: 36, depth: 30, height: 12, frontZ: -13 } as const;

export interface DisplaySurfaces {
  readonly main: THREE.Mesh;
  readonly left: THREE.Mesh;
  readonly right: THREE.Mesh;
}

function std(cache: ResourceCache, key: string, p: THREE.MeshStandardMaterialParameters) {
  return cache.material(`mc:${key}`, () => new THREE.MeshStandardMaterial(p));
}

function box(cache: ResourceCache, w: number, h: number, d: number) {
  return cache.geometry(`mc:box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  items: readonly { p: [number, number, number]; ry?: number; rx?: number }[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  items.forEach((it, i) => {
    q.setFromEuler(e.set(it.rx ?? 0, it.ry ?? 0, 0));
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...it.p), q, one));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Builds the room. Display meshes get their materials (canvas textures) from the caller. */
export function buildControlRoom(
  cache: ResourceCache,
  displayMaterials: {
    main: THREE.Material;
    left: THREE.Material;
    right: THREE.Material;
    console: THREE.Material;
  },
): { group: THREE.Group; displays: DisplaySurfaces } {
  const { width: W, depth: D, height: H, frontZ } = ROOM;
  const g = new THREE.Group();
  g.name = 'control-room';

  // Shell
  const carpet = std(cache, 'carpet', { color: 0x1b2333, roughness: 0.95 });
  const wall = std(cache, 'wall', { color: 0x3a4350, roughness: 0.85, metalness: 0.15 });
  const panel = std(cache, 'panel', { color: 0x4a5566, roughness: 0.55, metalness: 0.35 });
  const floor = new THREE.Mesh(
    cache.geometry('mc:floor', () => new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2)),
    carpet,
  );
  floor.position.z = frontZ + D / 2;
  const ceiling = new THREE.Mesh(
    cache.geometry('mc:ceiling', () => new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2)),
    wall,
  );
  ceiling.position.set(0, H, frontZ + D / 2);
  const front = new THREE.Mesh(
    cache.geometry('mc:front', () => new THREE.PlaneGeometry(W, H)),
    wall,
  );
  front.position.set(0, H / 2, frontZ);
  const sideGeo = cache.geometry('mc:side', () => new THREE.PlaneGeometry(D, H));
  const left = new THREE.Mesh(sideGeo, wall);
  left.position.set(-W / 2, H / 2, frontZ + D / 2);
  left.rotation.y = Math.PI / 2;
  const right = new THREE.Mesh(sideGeo, wall);
  right.position.set(W / 2, H / 2, frontZ + D / 2);
  right.rotation.y = -Math.PI / 2;
  const back = new THREE.Mesh(
    cache.geometry('mc:back', () => new THREE.PlaneGeometry(W, H)),
    wall,
  );
  back.position.set(0, H / 2, frontZ + D);
  back.rotation.y = Math.PI;
  g.add(floor, ceiling, front, left, right, back);

  // Wall displays with bezels
  const bezel = std(cache, 'bezel', { color: 0x0b0e13, roughness: 0.4, metalness: 0.6 });
  const addDisplay = (
    w: number,
    h: number,
    x: number,
    y: number,
    mat: THREE.Material,
    rotY = 0,
  ) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, frontZ + 0.15);
    holder.rotation.y = rotY;
    const frameMesh = new THREE.Mesh(box(cache, w + 0.4, h + 0.4, 0.2), bezel);
    const screen = new THREE.Mesh(
      cache.geometry(`mc:screen:${w}:${h}`, () => new THREE.PlaneGeometry(w, h)),
      mat,
    );
    screen.position.z = 0.11;
    holder.add(frameMesh, screen);
    g.add(holder);
    return screen;
  };
  const displays: DisplaySurfaces = {
    main: addDisplay(15.5, 6.8, 0, 6.6, displayMaterials.main),
    left: addDisplay(6.4, 4, -12, 6.4, displayMaterials.left, 0.12),
    right: addDisplay(6.4, 4, 12, 6.4, displayMaterials.right, -0.12),
  };

  // Tiered console rows
  const tiers = [
    { z: frontZ + 9, y: 0, count: 6 },
    { z: frontZ + 14, y: 0.6, count: 7 },
    { z: frontZ + 19, y: 1.2, count: 8 },
  ];
  const deskItems: { p: [number, number, number] }[] = [];
  const screenItems: { p: [number, number, number]; rx: number }[] = [];
  const chairItems: { p: [number, number, number] }[] = [];
  const platforms: { p: [number, number, number] }[] = [];
  for (const t of tiers) {
    if (t.y > 0) platforms.push({ p: [0, t.y / 2, t.z + 0.5] });
    const spacing = 3.3;
    for (let i = 0; i < t.count; i++) {
      const x = (i - (t.count - 1) / 2) * spacing;
      deskItems.push({ p: [x, t.y + 0.5, t.z] });
      screenItems.push(
        { p: [x - 0.7, t.y + 1.35, t.z - 0.25], rx: -0.25 },
        { p: [x + 0.7, t.y + 1.35, t.z - 0.25], rx: -0.25 },
      );
      chairItems.push({ p: [x, t.y + 0.45, t.z + 1.3] });
    }
  }
  g.add(instanced(box(cache, W - 4, 0.6 * 1, 5), carpet, platforms.slice(0, 1)));
  if (platforms[1]) g.add(instanced(box(cache, W - 2, 1.2, 5), carpet, [platforms[1]]));
  g.add(instanced(box(cache, 3.0, 1.0, 1.1), panel, deskItems));
  g.add(instanced(box(cache, 1.2, 0.75, 0.06), displayMaterials.console, screenItems));
  g.add(
    instanced(
      box(cache, 0.7, 0.9, 0.7),
      std(cache, 'chair', { color: 0x30384a, roughness: 0.7 }),
      chairItems,
    ),
  );

  // Flight director's podium
  const podium = new THREE.Mesh(
    box(cache, 4, 1.1, 1.4),
    std(cache, 'podium', { color: 0x3a3226, roughness: 0.5, metalness: 0.3 }),
  );
  podium.position.set(0, 1.8, frontZ + 22.5);
  g.add(podium);

  // Ceiling light strips (emissive) and a glass gallery at the back
  const strips: { p: [number, number, number] }[] = [];
  for (let z = frontZ + 5; z < frontZ + D - 2; z += 5) {
    for (let x = -12; x <= 12; x += 6) strips.push({ p: [x, H - 0.1, z] });
  }
  g.add(
    instanced(
      box(cache, 2.4, 0.06, 0.9),
      cache.material('mc:strip', () => new THREE.MeshBasicMaterial({ color: 0xb8c6da })),
      strips,
    ),
  );
  const glass = new THREE.Mesh(
    cache.geometry('mc:glass', () => new THREE.PlaneGeometry(W - 4, 4)),
    cache.material(
      'mc:glassMat',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x88aacc,
          transparent: true,
          opacity: 0.18,
          roughness: 0.05,
          metalness: 0.2,
          depthWrite: false,
        }),
    ),
  );
  glass.position.set(0, 7, frontZ + D - 3);
  glass.rotation.y = Math.PI;
  g.add(glass);
  const rail = new THREE.Mesh(
    box(cache, W - 4, 0.15, 0.15),
    std(cache, 'rail', { color: 0xf0a830, metalness: 0.4, roughness: 0.4 }),
  );
  rail.position.set(0, 5, frontZ + D - 3);
  g.add(rail);

  // Lighting: dim ambient, cool fill from the screens, warm downlights over the consoles
  g.add(new THREE.HemisphereLight(0x8899bb, 0x161a20, 1.1));
  const screenGlow = new THREE.PointLight(0x5aa0ff, 260, 40, 2);
  screenGlow.position.set(0, 6, frontZ + 3);
  g.add(screenGlow);
  for (const t of tiers) {
    const lamp = new THREE.PointLight(0xffd9a8, 380, 24, 2);
    lamp.position.set(0, H - 1.5, t.z);
    g.add(lamp);
  }
  return { group: g, displays };
}
