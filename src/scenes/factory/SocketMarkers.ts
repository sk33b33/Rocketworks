import * as THREE from 'three';
import type { AttachTarget } from '../../rocket/assembly/compatibility';
import type { PartDefinition, SocketRef } from '../../rocket/model/types';
import type { BlueprintRenderer } from '../../render/rocket/BlueprintRenderer';
import { buildPartObject } from '../../render/rocket/partRecipes';
import { getRocketMaterials } from '../../render/rocket/rocketMaterials';
import type { ResourceCache } from '../../render/ResourceCache';

const VALID = 0x3ddc84;
const INVALID = 0xff5a4a;

interface Marker {
  readonly object: THREE.Object3D;
  readonly hit: THREE.Mesh;
  readonly ref: SocketRef;
  readonly valid: boolean;
}

/**
 * Attachment-point indicators for the selected catalog part. Valid sockets are large pulsing
 * green rings; invalid ones are small red dots (size differs too, so color is not the only cue).
 * Hovering a valid socket shows a translucent preview of the part snapped in place.
 */
export class SocketMarkers {
  private markers: Marker[] = [];
  private ghost: THREE.Object3D | null = null;
  private hovered: Marker | null = null;
  private elapsed = 0;

  constructor(
    private readonly cache: ResourceCache,
    private readonly rocket: BlueprintRenderer,
  ) {}

  show(targets: readonly AttachTarget[]): void {
    this.clear();
    const validCore = this.cache.geometry(
      'marker:core',
      () => new THREE.SphereGeometry(0.55, 16, 12),
    );
    const validRing = this.cache.geometry(
      'marker:ring',
      () => new THREE.TorusGeometry(1.0, 0.09, 8, 32),
    );
    const invalidCore = this.cache.geometry(
      'marker:invalid',
      () => new THREE.SphereGeometry(0.32, 12, 8),
    );
    const hitGeo = this.cache.geometry('marker:hit', () => new THREE.SphereGeometry(1.1, 10, 8));
    const mat = (key: string, color: number, opacity: number) =>
      this.cache.material(
        `marker:${key}`,
        () =>
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
            fog: false,
          }),
      );
    const hitMat = this.cache.material(
      'marker:hitMat',
      () => new THREE.MeshBasicMaterial({ visible: false }),
    );

    for (const target of targets) {
      const node = this.rocket.getSocketNode(target.ref);
      if (!node) continue;
      const valid = target.check.ok;
      const group = new THREE.Group();
      group.userData.helper = true;
      if (valid) {
        const core = new THREE.Mesh(validCore, mat('valid', VALID, 0.9));
        const ring = new THREE.Mesh(validRing, mat('validRing', VALID, 0.75));
        ring.lookAt(0, 1, 0); // horizontal-ish, orientation follows the socket frame
        group.add(core, ring);
      } else {
        group.add(new THREE.Mesh(invalidCore, mat('invalid', INVALID, 0.55)));
      }
      group.traverse((o) => {
        o.renderOrder = 20;
        o.userData.helper = true;
      });
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.helper = true;
      hit.scale.setScalar(valid ? 1 : 0.6);
      group.add(hit);
      node.add(group);
      this.markers.push({ object: group, hit, ref: target.ref, valid });
    }
  }

  /** Marker under the ray, preferring valid markers. */
  pick(raycaster: THREE.Raycaster): { ref: SocketRef; valid: boolean } | null {
    const hits = raycaster.intersectObjects(
      this.markers.map((m) => m.hit),
      false,
    );
    const markers = hits
      .map((h) => this.markers.find((m) => m.hit === h.object))
      .filter((m): m is Marker => !!m);
    const best = markers.find((m) => m.valid) ?? markers[0];
    return best ? { ref: best.ref, valid: best.valid } : null;
  }

  /** Highlights the hovered marker and previews the part there if valid. */
  setHover(
    ref: SocketRef | null,
    part: PartDefinition | null,
    span?: AttachTarget['socket']['span'],
  ): void {
    const marker = ref
      ? (this.markers.find(
          (m) => m.ref.parentId === ref.parentId && m.ref.socketId === ref.socketId,
        ) ?? null)
      : null;
    if (marker === this.hovered) return;
    if (this.hovered) this.hovered.object.scale.setScalar(1);
    this.removeGhost();
    this.hovered = marker;
    if (!marker) return;
    marker.object.scale.setScalar(1.35);
    if (marker.valid && part) {
      const ghost = buildPartObject({
        part,
        cache: this.cache,
        mats: getRocketMaterials(this.cache),
        ...(span ? { span } : {}),
      });
      const ghostMat = this.cache.material(
        'marker:ghost',
        () =>
          new THREE.MeshStandardMaterial({
            color: VALID,
            emissive: VALID,
            emissiveIntensity: 0.35,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          }),
      );
      ghost.traverse((o) => {
        o.userData.helper = true;
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).material = ghostMat;
          o.castShadow = false;
        }
      });
      this.rocket.getSocketNode(marker.ref)?.add(ghost);
      this.ghost = ghost;
    }
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    const pulse = 1 + Math.sin(this.elapsed * 4) * 0.12;
    for (const m of this.markers) {
      if (m.valid && m !== this.hovered) m.object.scale.setScalar(pulse);
    }
  }

  get count(): number {
    return this.markers.length;
  }

  clear(): void {
    this.removeGhost();
    for (const m of this.markers) m.object.removeFromParent();
    this.markers = [];
    this.hovered = null;
  }

  private removeGhost(): void {
    this.ghost?.removeFromParent();
    this.ghost = null;
  }
}
