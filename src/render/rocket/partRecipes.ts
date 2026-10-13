import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ENGINE_BELL_LENGTH_M,
  ENGINE_BELL_RADIUS_M,
  HULL_RADIUS_M,
  noseRadiusAt,
} from '../../rocket/model/geometry';
import type { PartDefinition, SocketSpan } from '../../rocket/model/types';
import type { ResourceCache } from '../ResourceCache';
import type { RocketMaterials } from './rocketMaterials';

/*
 * Procedural visual recipes, one per PartDefinition.visual key. Each recipe returns an object whose
 * origin is the part's attachment point, matching the socket conventions in rocket/model/types.ts.
 * Geometry is cached by key so repeated parts share GPU buffers.
 */

export interface RecipeContext {
  readonly part: PartDefinition;
  readonly cache: ResourceCache;
  readonly mats: RocketMaterials;
  /** Span of the socket this part is attached to (heat shield wraps its parent section). */
  readonly span?: SocketSpan;
}

type Recipe = (ctx: RecipeContext) => THREE.Object3D;

const R = HULL_RADIUS_M;
const DEG = Math.PI / 180;

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

interface BoxSpec {
  size: [number, number, number];
  pos: [number, number, number];
  rotY?: number;
  rotZ?: number;
}

/** One merged geometry from several boxes. */
function boxes(cache: ResourceCache, key: string, specs: readonly BoxSpec[]): THREE.BufferGeometry {
  return cache.geometry(`boxes:${key}`, () => {
    const parts = specs.map((s) => {
      const g = new THREE.BoxGeometry(...s.size);
      if (s.rotZ) g.rotateZ(s.rotZ);
      if (s.rotY) g.rotateY(s.rotY);
      g.translate(...s.pos);
      return g;
    });
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!merged) throw new Error(`Could not merge ${key}`);
    return merged;
  });
}

/** Box placed on the hull surface at a polar angle (local +X outward). */
function radialBox(
  angleDeg: number,
  y: number,
  size: [number, number, number],
  radius = R,
): BoxSpec {
  const a = angleDeg * DEG;
  const out = radius + size[0] / 2;
  return { size, pos: [out * Math.cos(a), y, out * Math.sin(a)], rotY: -a };
}

function scaleUv(geometry: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geometry;
}

/** Open steel barrel with weld seams and a top bulkhead. */
function barrel(ctx: RecipeContext, height: number, seamStep = 2): THREE.Group {
  const { cache, mats } = ctx;
  const g = new THREE.Group();
  const shell = cache.geometry(
    `barrel:${height}`,
    () => new THREE.CylinderGeometry(R, R, height, 64, 1, true),
  );
  g.add(mesh(shell, mats.steel, 0, height / 2, 0));
  const seams = cache.geometry(`seams:${height}:${seamStep}`, () => {
    const rings: THREE.BufferGeometry[] = [];
    for (let y = seamStep; y < height - 0.1; y += seamStep) {
      const t = new THREE.TorusGeometry(R + 0.01, 0.035, 6, 96);
      t.rotateX(Math.PI / 2);
      t.translate(0, y, 0);
      rings.push(t);
    }
    const merged = rings.length ? mergeGeometries(rings) : new THREE.BufferGeometry();
    for (const r of rings) r.dispose();
    return merged ?? new THREE.BufferGeometry();
  });
  g.add(mesh(seams, mats.steelSeam));
  const cap = cache.geometry('bulkhead', () =>
    new THREE.CircleGeometry(R - 0.02, 64).rotateX(-Math.PI / 2),
  );
  g.add(mesh(cap, mats.steelSeam, 0, height - 0.05, 0));
  return g;
}

function bottomPlate(ctx: RecipeContext, y: number): THREE.Mesh {
  const geo = ctx.cache.geometry('bottomPlate', () =>
    new THREE.CircleGeometry(R - 0.02, 64).rotateX(Math.PI / 2),
  );
  return mesh(geo, ctx.mats.darkMetal, 0, y, 0);
}

function engine(ctx: RecipeContext, length: number, exitRadius: number, key: string): THREE.Group {
  const { cache, mats } = ctx;
  const g = new THREE.Group();
  const head = cache.geometry('engine:head', () => new THREE.CylinderGeometry(0.38, 0.45, 0.9, 20));
  g.add(mesh(head, mats.darkMetal, 0, 0.45, 0));
  const pumps = boxes(cache, 'engine:pumps', [
    { size: [0.3, 0.6, 0.3], pos: [0.42, 0.5, 0] },
    { size: [0.3, 0.6, 0.3], pos: [-0.42, 0.5, 0] },
  ]);
  g.add(mesh(pumps, mats.titanium));
  const bell = cache.geometry(`engine:bell:${key}`, () => {
    const pts: THREE.Vector2[] = [];
    const throat = 0.3;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(
        new THREE.Vector2(
          throat + (exitRadius - throat) * Math.pow(t, 0.6),
          0.9 + t * (length - 0.9),
        ),
      );
    }
    return new THREE.LatheGeometry(pts, 32);
  });
  g.add(mesh(bell, mats.bell));
  const throatRing = cache.geometry('engine:throat', () =>
    new THREE.TorusGeometry(0.33, 0.06, 8, 24).rotateX(Math.PI / 2),
  );
  g.add(mesh(throatRing, mats.copper, 0, 0.95, 0));
  return g;
}

function flap(
  ctx: RecipeContext,
  key: string,
  root: [number, number],
  tipX: number,
  tip: [number, number],
): THREE.Mesh {
  const geo = ctx.cache.geometry(`flap:${key}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0.2, root[0]);
    s.lineTo(tipX, tip[0]);
    s.lineTo(tipX, tip[1]);
    s.lineTo(0.2, root[1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
    g.translate(0, 0, -0.15);
    return g;
  });
  return mesh(geo, ctx.mats.tile);
}

export const PART_RECIPES: Readonly<Record<string, Recipe>> = {
  'booster-engine-section': (ctx) => {
    const g = barrel(ctx, 6, 2);
    g.add(bottomPlate(ctx, 0.2));
    const band = ctx.cache.geometry(
      'aftBand',
      () => new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.7, 64, 1, true),
    );
    g.add(mesh(band, ctx.mats.darkMetal, 0, 0.35, 0));
    g.add(
      mesh(
        boxes(ctx.cache, 'hpu', [
          radialBox(90, 4.8, [0.7, 1.2, 1.4]),
          radialBox(270, 4.8, [0.7, 1.2, 1.4]),
        ]),
        ctx.mats.steelSeam,
      ),
    );
    return g;
  },
  'booster-tank-short': (ctx) => barrel(ctx, 5, 2.5),
  'booster-tank': (ctx) => {
    const g = barrel(ctx, 10, 2);
    g.add(
      mesh(boxes(ctx.cache, 'stringer10', [radialBox(0, 5, [0.35, 10, 0.5])]), ctx.mats.steelSeam),
    );
    return g;
  },
  'booster-forward-section': (ctx) => {
    const g = barrel(ctx, 5, 2.5);
    const housings = [45, 135, 225, 315].map((a) => radialBox(a, 3.2, [0.45, 1.6, 1.3]));
    g.add(mesh(boxes(ctx.cache, 'finHousings', housings), ctx.mats.darkMetal));
    const dome = ctx.cache.geometry('fwdDome', () =>
      new THREE.SphereGeometry(R - 0.05, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1),
    );
    g.add(mesh(dome, ctx.mats.steelSeam, 0, 5 - 0.05, 0));
    return g;
  },
  interstage: (ctx) => {
    const g = new THREE.Group();
    const ringGeo = ctx.cache.geometry(
      'interstageRing',
      () => new THREE.CylinderGeometry(R, R, 0.35, 64, 1, true),
    );
    g.add(mesh(ringGeo, ctx.mats.steel, 0, 0.175, 0), mesh(ringGeo, ctx.mats.steel, 0, 2.325, 0));
    const struts = Array.from({ length: 24 }, (_, i) =>
      radialBox(i * 15, 1.25, [0.3, 1.8, 0.35], R - 0.3),
    );
    g.add(mesh(boxes(ctx.cache, 'interstageStruts', struts), ctx.mats.darkMetal));
    return g;
  },
  'ship-aft-section': (ctx) => {
    const g = barrel(ctx, 6, 2);
    g.add(bottomPlate(ctx, 0.45));
    g.add(
      mesh(
        boxes(ctx.cache, 'aftHinges', [
          radialBox(0, 2.8, [0.5, 3.8, 1.1]),
          radialBox(180, 2.8, [0.5, 3.8, 1.1]),
        ]),
        ctx.mats.steelSeam,
      ),
    );
    return g;
  },
  'ship-tank': (ctx) => barrel(ctx, 8, 2),
  'ship-tank-extended': (ctx) => barrel(ctx, 12, 2),
  'crew-cabin': (ctx) => {
    const g = barrel(ctx, 7, 3.5);
    const windows = Array.from({ length: 10 }, (_, i) =>
      radialBox(200 + i * 15.5, 4.4, [0.12, 0.6, 0.75], R - 0.04),
    );
    g.add(mesh(boxes(ctx.cache, 'cabinWindows', windows), ctx.mats.glass));
    return g;
  },
  'cargo-bay': (ctx) => {
    const g = barrel(ctx, 7, 3.5);
    const seams = [radialBox(235, 3.5, [0.08, 5.2, 0.1]), radialBox(305, 3.5, [0.08, 5.2, 0.1])];
    g.add(mesh(boxes(ctx.cache, 'bayDoorSides', seams), ctx.mats.darkMetal));
    const arc = ctx.cache.geometry('bayDoorArc', () =>
      new THREE.TorusGeometry(R + 0.03, 0.05, 6, 24, 70 * DEG)
        .rotateX(Math.PI / 2)
        .rotateY(-235 * DEG),
    );
    g.add(mesh(arc, ctx.mats.darkMetal, 0, 0.9, 0), mesh(arc, ctx.mats.darkMetal, 0, 6.1, 0));
    return g;
  },
  'nose-cone': (ctx) => {
    const h = ctx.part.heightM ?? 9;
    const g = new THREE.Group();
    const shell = ctx.cache.geometry(`nose:${h}`, () => {
      const pts = Array.from(
        { length: 33 },
        (_, i) => new THREE.Vector2(noseRadiusAt((h * i) / 32, h), (h * i) / 32),
      );
      return new THREE.LatheGeometry(pts, 64);
    });
    g.add(mesh(shell, ctx.mats.steel));
    const hinge = (a: number) => radialBox(a, 2.5, [0.5, 2.6, 0.9], R * 0.95);
    g.add(mesh(boxes(ctx.cache, 'noseHinges', [hinge(0), hinge(180)]), ctx.mats.steelSeam));
    return g;
  },
  'engine-sl': (ctx) => engine(ctx, ENGINE_BELL_LENGTH_M, ENGINE_BELL_RADIUS_M, 'sl'),
  'engine-sl-b2': (ctx) => {
    const g = engine(ctx, ENGINE_BELL_LENGTH_M, ENGINE_BELL_RADIUS_M, 'sl');
    const band = ctx.cache.geometry('engine:b2band', () =>
      new THREE.TorusGeometry(ENGINE_BELL_RADIUS_M - 0.02, 0.05, 8, 32).rotateX(Math.PI / 2),
    );
    g.add(mesh(band, ctx.mats.copper, 0, ENGINE_BELL_LENGTH_M - 0.05, 0));
    return g;
  },
  'engine-vac': (ctx) => engine(ctx, 4.2, 1.35, 'vac'),
  'grid-fin': (ctx) => {
    const specs: BoxSpec[] = [
      { size: [0.5, 0.5, 0.5], pos: [0.25, 0, 0] },
      { size: [2.4, 0.12, 0.35], pos: [1.5, 1.3, 0] },
      { size: [2.4, 0.12, 0.35], pos: [1.5, -1.3, 0] },
      { size: [0.12, 2.72, 0.35], pos: [0.3, 0, 0] },
      { size: [0.12, 2.72, 0.35], pos: [2.7, 0, 0] },
    ];
    for (let k = 1; k <= 5; k++)
      specs.push({ size: [0.05, 2.6, 0.32], pos: [0.3 + k * 0.4, 0, 0] });
    for (let k = 1; k <= 5; k++)
      specs.push({ size: [2.4, 0.05, 0.32], pos: [1.5, -1.3 + k * (2.6 / 6), 0] });
    return mesh(boxes(ctx.cache, 'gridFin', specs), ctx.mats.titanium);
  },
  'flap-forward': (ctx) => flap(ctx, 'fwd', [-1.3, 1.6], 2.4, [-0.6, 1.0]),
  'flap-aft': (ctx) => flap(ctx, 'aft', [-2.0, 2.0], 3.2, [-1.3, 1.1]),
  'landing-leg': (ctx) => {
    const g = new THREE.Group();
    g.add(
      mesh(
        boxes(ctx.cache, 'legStrut', [
          { size: [0.32, 4.4, 0.5], pos: [0.3, 1.0, 0] },
          { size: [0.18, 2.6, 0.22], pos: [0.62, 1.6, 0], rotZ: 0.12 },
        ]),
        ctx.mats.darkMetal,
      ),
    );
    const pad = ctx.cache.geometry('legPad', () => new THREE.CylinderGeometry(0.55, 0.6, 0.2, 20));
    g.add(mesh(pad, ctx.mats.titanium, 0.55, -1.25, 0));
    return g;
  },
  'heat-shield': (ctx) => {
    const span = ctx.span ?? { heightM: 6, profile: 'cylinder' as const };
    const h = span.heightM;
    const tile = 1.4;
    if (span.profile === 'ogive') {
      const geo = ctx.cache.geometry(`shield:ogive:${h}`, () => {
        const pts = Array.from({ length: 25 }, (_, i) => {
          const y = (h * 0.93 * i) / 24;
          return new THREE.Vector2(noseRadiusAt(y, h) + 0.05, y);
        });
        return scaleUv(
          new THREE.LatheGeometry(pts, 48, -Math.PI / 2, Math.PI),
          (Math.PI * R) / tile,
          h / tile,
        );
      });
      return mesh(geo, ctx.mats.tile);
    }
    const geo = ctx.cache.geometry(`shield:cyl:${h}`, () =>
      scaleUv(
        new THREE.CylinderGeometry(R + 0.05, R + 0.05, h, 48, 1, true, -Math.PI / 2, Math.PI),
        (Math.PI * R) / tile,
        h / tile,
      ),
    );
    return mesh(geo, ctx.mats.tile, 0, h / 2, 0);
  },
  'docking-adapter': (ctx) => {
    const g = new THREE.Group();
    const base = ctx.cache.geometry(
      'dockBase',
      () => new THREE.CylinderGeometry(1.0, 1.25, 0.6, 32),
    );
    g.add(mesh(base, ctx.mats.darkMetal, 0, 0.3, 0));
    const ring = ctx.cache.geometry('dockRing', () =>
      new THREE.TorusGeometry(1.0, 0.12, 10, 40).rotateX(Math.PI / 2),
    );
    g.add(mesh(ring, ctx.mats.accent, 0, 0.65, 0));
    const petals = [0, 120, 240].map((a): BoxSpec => {
      const r = a * DEG;
      return {
        size: [0.1, 0.7, 0.55],
        pos: [0.85 * Math.cos(r), 0.95, 0.85 * Math.sin(r)],
        rotY: -r,
        rotZ: 0.25,
      };
    });
    g.add(mesh(boxes(ctx.cache, 'dockPetals', petals), ctx.mats.accent));
    return g;
  },
  'rcs-block': (ctx) => {
    const g = new THREE.Group();
    g.add(
      mesh(
        boxes(ctx.cache, 'rcsBody', [{ size: [0.5, 0.7, 1.0], pos: [0.25, 0, 0] }]),
        ctx.mats.darkMetal,
      ),
    );
    const nozzle = ctx.cache.geometry('rcsNozzle', () =>
      new THREE.ConeGeometry(0.1, 0.25, 10).rotateZ(-Math.PI / 2),
    );
    for (const z of [-0.3, 0, 0.3]) g.add(mesh(nozzle, ctx.mats.bell, 0.6, 0, z));
    return g;
  },
  antenna: (ctx) => {
    const g = new THREE.Group();
    g.add(
      mesh(
        boxes(ctx.cache, 'antennaBase', [{ size: [0.2, 0.3, 0.3], pos: [0.1, 0, 0] }]),
        ctx.mats.darkMetal,
      ),
    );
    const mast = ctx.cache.geometry(
      'antennaMast',
      () => new THREE.CylinderGeometry(0.04, 0.05, 1.8, 8),
    );
    g.add(mesh(mast, ctx.mats.accent, 0.25, 0.9, 0));
    const tip = ctx.cache.geometry('antennaTip', () => new THREE.SphereGeometry(0.09, 10, 8));
    g.add(mesh(tip, ctx.mats.accent, 0.25, 1.82, 0));
    return g;
  },
  'access-hatch': (ctx) =>
    mesh(
      boxes(ctx.cache, 'hatch', [
        { size: [0.06, 1.4, 1.1], pos: [0.03, 0, 0] },
        { size: [0.08, 0.1, 0.4], pos: [0.08, -0.4, 0] },
      ]),
      ctx.mats.steelSeam,
    ),
  'plumbing-conduit': (ctx) => {
    const g = new THREE.Group();
    g.add(
      mesh(
        boxes(ctx.cache, 'conduit', [{ size: [0.45, 6, 0.7], pos: [0.22, 0, 0] }]),
        ctx.mats.steelSeam,
      ),
    );
    const pipe = ctx.cache.geometry(
      'conduitPipe',
      () => new THREE.CylinderGeometry(0.11, 0.11, 6, 10),
    );
    g.add(
      mesh(pipe, ctx.mats.titanium, 0.55, 0, 0.18),
      mesh(pipe, ctx.mats.titanium, 0.55, 0, -0.18),
    );
    return g;
  },
  'solar-array': (ctx) =>
    mesh(boxes(ctx.cache, 'solar', [{ size: [0.4, 1.6, 1.2], pos: [0.2, 0, 0] }]), ctx.mats.solar),
};

export function buildPartObject(ctx: RecipeContext): THREE.Object3D {
  const recipe = PART_RECIPES[ctx.part.visual];
  if (!recipe) throw new Error(`No visual recipe for "${ctx.part.visual}"`);
  return recipe(ctx);
}
