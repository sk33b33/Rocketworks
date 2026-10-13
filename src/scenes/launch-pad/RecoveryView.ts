import * as THREE from 'three';
import type { RecoverySessionView } from '../../recovery/recoverySession';
import { CATCH_HEIGHT_M } from '../../recovery/recoveryPlan';
import type { ResourceCache } from '../../render/ResourceCache';
import { placeOnEarth } from './flightView';
import type { LaunchSite } from './LaunchSite';
import { MOUNT_TOP_M } from './LaunchSite';

/*
 * Booster recovery visuals at the launch site and downrange: catch-arm animation, the ocean
 * landing platform with a local patch of sea, and lowering a caught booster onto the mount.
 */

/** The arms close on the booster's catch points, this far up its length. */
export const ARMS_AT_LENGTH_SHARE = 0.82;
const LOWER_SECONDS = 8;
const DECK_TOP_M = 2;

export class RecoveryView {
  readonly droneship = new THREE.Group();
  private caughtFor = 0;

  constructor(
    cache: ResourceCache,
    private readonly site: LaunchSite,
  ) {
    const steel = cache.material(
      'rec:steel',
      () => new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6, metalness: 0.6 }),
    );
    const deck = cache.material(
      'rec:deck',
      () => new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.85, metalness: 0.2 }),
    );
    const paint = cache.material(
      'rec:paint',
      () => new THREE.MeshBasicMaterial({ color: 0xf2c230, fog: false }),
    );
    const sea = cache.material(
      'rec:sea',
      () => new THREE.MeshStandardMaterial({ color: 0x1b4b78, roughness: 0.3, metalness: 0.1 }),
    );
    const hull = new THREE.Mesh(
      cache.geometry('rec:hull', () => new THREE.BoxGeometry(110, 8, 80)),
      steel,
    );
    hull.position.y = DECK_TOP_M - 5;
    const top = new THREE.Mesh(
      cache.geometry('rec:deckTop', () => new THREE.BoxGeometry(100, 1, 72)),
      deck,
    );
    top.position.y = DECK_TOP_M - 0.5;
    const ring = new THREE.Mesh(
      cache.geometry('rec:ring', () => new THREE.RingGeometry(16, 19, 48).rotateX(-Math.PI / 2)),
      paint,
    );
    ring.position.y = DECK_TOP_M + 0.05;
    const ocean = new THREE.Mesh(
      cache.geometry('rec:ocean', () => new THREE.CircleGeometry(30_000, 64).rotateX(-Math.PI / 2)),
      sea,
    );
    ocean.position.y = -1;
    this.droneship.add(ocean, hull, top, ring);
    for (const x of [-48, 48]) {
      const mast = new THREE.Mesh(
        cache.geometry('rec:mast', () => new THREE.BoxGeometry(2, 14, 2)),
        steel,
      );
      mast.position.set(x, DECK_TOP_M + 7, -32);
      this.droneship.add(mast);
    }
    this.droneship.visible = false;
  }

  /** Booster base height in the scene (above the local ground or deck). */
  boosterBaseY(v: RecoverySessionView): number {
    if (v.state.phase === 'caught') {
      const t = Math.min(1, this.caughtFor / LOWER_SECONDS);
      return CATCH_HEIGHT_M + (MOUNT_TOP_M - CATCH_HEIGHT_M) * (t * t * (3 - 2 * t));
    }
    if (v.state.phase === 'landed') return DECK_TOP_M;
    return v.state.h;
  }

  update(v: RecoverySessionView | null, dt: number, boosterLengthM: number): void {
    const arms = this.site.catchArms;
    if (!v) {
      this.droneship.visible = false;
      this.caughtFor = 0;
      return;
    }
    if (v.target.mode === 'platform') {
      const p = placeOnEarth(v.target.x, 0);
      this.droneship.position.set(p.x, p.y, 0);
      this.droneship.rotation.set(0, 0, -p.arcRad);
      this.droneship.visible = true;
    } else {
      this.droneship.visible = false;
    }
    // Catch arms: waiting open at catch height, closing on capture, then lowering to the mount.
    if (v.target.mode !== 'catch') return;
    const caught = v.state.phase === 'caught';
    if (caught) this.caughtFor += dt;
    arms.position.y = this.boosterBaseY(v) + boosterLengthM * ARMS_AT_LENGTH_SHARE;
    const close = caught ? Math.min(1, this.caughtFor / 1.2) : 0;
    for (const [i, arm] of arms.children.slice(1).entries()) {
      const side = i === 0 ? -1 : 1;
      arm.rotation.y = side * (-0.3 + 0.38 * close);
    }
  }

  /** Restores the stacking pose of the arms (new launch). */
  reset(): void {
    this.caughtFor = 0;
    this.droneship.visible = false;
    for (const [i, arm] of this.site.catchArms.children.slice(1).entries()) {
      arm.rotation.y = (i === 0 ? -1 : 1) * 0.08;
    }
  }
}
