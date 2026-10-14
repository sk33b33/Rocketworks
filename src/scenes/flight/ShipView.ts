import * as THREE from 'three';
import { autoMotion } from '../../render/motion';
import type { FlightState } from '../../flight/flightModel';
import { localFrame } from '../../flight/orbitMath';
import { shipOnlyBlueprint } from '../../flight/shipSpec';
import { findPart } from '../../rocket/catalog/parts';
import type { RocketBlueprint } from '../../rocket/model/types';
import { BlueprintRenderer } from '../../render/rocket/BlueprintRenderer';
import type { ResourceCache } from '../../render/ResourceCache';
import { createPlume, Fireball, updatePlume, type Plume } from '../launch-pad/Effects';
import {
  collectMovingParts,
  setFlaps,
  setLegs,
  type MovingParts,
} from '../../render/rocket/partAnimation';

/*
 * The ship on its own (booster left behind), oriented from the simulation attitude: model +Y is
 * the nose, model +Z the tiled belly. Adds engine plumes, a re-entry plasma glow on the windward
 * side and a breakup fireball.
 */

const PLASMA_FULL_WM2 = 600_000;

export class ShipView {
  readonly root = new THREE.Group();
  private readonly renderer: BlueprintRenderer;
  private plumes: Plume[] = [];
  private readonly plasma: THREE.Mesh;
  private readonly plasmaMat: THREE.MeshBasicMaterial;
  private readonly fireball: Fireball;
  private builtFor: string | null = null;
  private moving: MovingParts | null = null;
  private legDeploy = 0;
  private exploded = false;
  lengthM = 50;
  private readonly basis = new THREE.Matrix4();
  private readonly nose = new THREE.Vector3();
  private readonly belly = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(private readonly cache: ResourceCache) {
    this.renderer = new BlueprintRenderer(cache);
    this.root.add(this.renderer.root);
    this.plasmaMat = cache.material(
      'flight:plasma',
      () =>
        new THREE.MeshBasicMaterial({
          color: 0xff8a3d,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
    );
    this.plasma = new THREE.Mesh(
      cache.geometry('flight:plasmaGeo', () => new THREE.SphereGeometry(1, 24, 16)),
      this.plasmaMat,
    );
    this.plasma.visible = false;
    this.root.add(this.plasma);
    this.fireball = new Fireball(cache);
  }

  get effects(): THREE.Object3D {
    return this.fireball.group;
  }

  /** Rebuilds the mesh when the flown design changes. */
  build(key: string, bp: RocketBlueprint): void {
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.exploded = false;
    this.renderer.clear();
    this.plumes = [];
    const ship = shipOnlyBlueprint(bp);
    this.renderer.build(ship);
    this.moving = collectMovingParts(this.renderer, ship);
    this.legDeploy = 0;
    this.lengthM = ship.parts.reduce((s, p) => s + (findPart(p.partId)?.heightM ?? 0), 0) || 50;
    for (const inst of ship.parts) {
      if (!findPart(inst.partId)?.thrustN) continue;
      const node = this.renderer.getInstanceNode(inst.id);
      if (!node) continue;
      const plume = createPlume(this.cache);
      node.add(plume.root);
      this.plumes.push(plume);
    }
    this.renderer.root.visible = true;
  }

  /**
   * Orients the ship (at the scene origin) and updates its effects. `frame` overrides Earth's
   * local vertical and altitude (near the Moon, attitude refers to the Moon).
   */
  update(
    s: FlightState,
    time: number,
    dt: number,
    frame?: {
      readonly up: readonly [number, number];
      readonly altitudeM: number;
      /** In an atmosphere (flaps trim the belly-flop). */
      readonly inAir?: boolean;
    },
  ): void {
    const f = frame
      ? {
          up: frame.up,
          east: [frame.up[1], -frame.up[0]] as const,
          altitudeM: frame.altitudeM,
        }
      : localFrame(s.r);
    const p = (s.pitchDeg * Math.PI) / 180;
    // Nose and belly in the orbital plane, then bank rolls the belly about the nose.
    this.nose.set(
      f.east[0] * Math.cos(p) + f.up[0] * Math.sin(p),
      f.east[1] * Math.cos(p) + f.up[1] * Math.sin(p),
      0,
    );
    this.belly.set(
      f.east[0] * Math.sin(p) - f.up[0] * Math.cos(p),
      f.east[1] * Math.sin(p) - f.up[1] * Math.cos(p),
      0,
    );
    this.belly.applyAxisAngle(this.nose, (s.bankDeg * Math.PI) / 180);
    this.side.crossVectors(this.nose, this.belly);
    this.basis.makeBasis(this.side, this.nose, this.belly);
    this.renderer.root.quaternion.setFromRotationMatrix(this.basis);
    // Visual-only yaw.
    this.renderer.root.rotateY((s.yawDeg * Math.PI) / 180);

    // Flaps trim the belly-flop (visual): deflect with the angle of attack error and bank.
    if (this.moving) {
      const inAir = frame ? !!frame.inAir : f.altitudeM < 90_000;
      const trim = inAir ? Math.max(-0.6, Math.min(0.6, (s.angleOfAttackDeg - 65) / 60)) : 0;
      const roll = inAir ? (s.bankDeg / 90) * 0.25 : 0;
      setFlaps(this.moving, trim + roll, -trim * 0.8 + roll);
      // Legs come down for the final approach once the ship is upright.
      const wantLegs = f.altitudeM < 2_500 && Math.abs(s.pitchDeg - 90) < 40;
      this.legDeploy = Math.max(0, Math.min(1, this.legDeploy + (wantLegs ? dt : -dt) / 3));
      if (s.phase === 'landed') this.legDeploy = 1;
      setLegs(this.moving, this.legDeploy);
    }

    const dead = s.phase === 'destroyed' || s.phase === 'crashed';
    if (dead && !this.exploded) {
      this.exploded = true;
      this.fireball.trigger(this.nose.clone().multiplyScalar(this.lengthM / 2));
    }
    this.renderer.root.visible = !dead;
    for (const [i, plume] of this.plumes.entries()) {
      updatePlume(plume, !dead && s.throttle > 0, s.throttle, f.altitudeM, time, i);
    }

    // Plasma sheath on the windward side, scaled with heat flux.
    const glow = dead ? 0 : Math.min(1, s.heatFluxWm2 / PLASMA_FULL_WM2);
    this.plasma.visible = glow > 0.02;
    if (this.plasma.visible) {
      const speed = Math.hypot(s.v[0], s.v[1]) || 1;
      const vx = s.v[0] / speed;
      const vy = s.v[1] / speed;
      this.plasma.position
        .copy(this.nose)
        .multiplyScalar(this.lengthM * 0.5)
        .add(new THREE.Vector3(vx, vy, 0).multiplyScalar(3 + glow * 3));
      this.plasma.quaternion.copy(this.renderer.root.quaternion);
      this.plasma.scale.set(5.5 + glow * 3, this.lengthM * (0.5 + glow * 0.12), 5.5 + glow * 3);
      this.plasmaMat.opacity = 0.15 + glow * 0.45;
      this.plasmaMat.color.setHSL(
        0.06 + 0.03 * (1 - glow),
        1,
        0.55 + autoMotion(0.1 * Math.sin(time * 40)),
      );
    }
    this.fireball.update(dt);
  }

  dispose(): void {
    this.renderer.clear();
    this.fireball.dispose();
    this.plumes = [];
    this.builtFor = null;
  }
}
