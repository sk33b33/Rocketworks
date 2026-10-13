import * as THREE from 'three';
import { STAND_SOCKET } from '../../rocket/assembly/compatibility';
import { findPart } from '../../rocket/catalog/parts';
import type { RocketBlueprint, SocketDefinition, SocketRef } from '../../rocket/model/types';
import type { ResourceCache } from '../ResourceCache';
import { buildPartObject } from './partRecipes';
import { getRocketMaterials } from './rocketMaterials';

export function socketKey(ref: SocketRef): string {
  return `${ref.parentId ?? 'stand'}/${ref.socketId}`;
}

function applySocketTransform(node: THREE.Object3D, socket: SocketDefinition): void {
  node.position.set(...socket.position);
  node.rotation.set(...socket.rotation);
}

/**
 * Translates a blueprint into a Three.js hierarchy: every instance is a group parented to its
 * parent's socket node, so transforms compose exactly as the attachment graph says. The same
 * adapter can render the vehicle in the factory, at the pad or in flight.
 */
export class BlueprintRenderer {
  readonly root = new THREE.Group();
  private readonly instanceNodes = new Map<string, THREE.Group>();
  private readonly socketNodes = new Map<string, THREE.Object3D>();

  constructor(private readonly cache: ResourceCache) {
    this.root.name = 'rocket';
  }

  build(bp: RocketBlueprint): void {
    this.clear();
    const mats = getRocketMaterials(this.cache, bp.finish);

    const standNode = new THREE.Object3D();
    applySocketTransform(standNode, STAND_SOCKET);
    standNode.userData.socketRef = {
      parentId: null,
      socketId: STAND_SOCKET.id,
    } satisfies SocketRef;
    this.root.add(standNode);
    this.socketNodes.set(socketKey({ parentId: null, socketId: STAND_SOCKET.id }), standNode);

    for (const inst of bp.parts) {
      const part = findPart(inst.partId);
      const parentNode = this.socketNodes.get(socketKey(inst.parent));
      if (!part || !parentNode) continue; // validated blueprints never hit this

      const parentSocket = inst.parent.parentId
        ? findPart(bp.parts.find((p) => p.id === inst.parent.parentId)?.partId ?? '')?.sockets.find(
            (s) => s.id === inst.parent.socketId,
          )
        : STAND_SOCKET;

      const group = new THREE.Group();
      group.name = `${part.id}#${inst.id}`;
      group.userData.instanceId = inst.id;
      group.rotation.y = (inst.rotationDeg * Math.PI) / 180;
      group.add(
        buildPartObject({
          part,
          cache: this.cache,
          mats,
          ...(parentSocket?.span ? { span: parentSocket.span } : {}),
        }),
      );

      for (const socket of part.sockets) {
        const node = new THREE.Object3D();
        applySocketTransform(node, socket);
        const ref: SocketRef = { parentId: inst.id, socketId: socket.id };
        node.userData.socketRef = ref;
        group.add(node);
        this.socketNodes.set(socketKey(ref), node);
      }
      parentNode.add(group);
      this.instanceNodes.set(inst.id, group);
    }
    this.root.updateMatrixWorld(true);
  }

  getInstanceNode(id: string): THREE.Group | undefined {
    return this.instanceNodes.get(id);
  }

  getSocketNode(ref: SocketRef): THREE.Object3D | undefined {
    return this.socketNodes.get(socketKey(ref));
  }

  /** Nearest instance id that owns the given object (walks up the hierarchy). */
  instanceIdOf(object: THREE.Object3D | null): string | null {
    for (let o = object; o; o = o.parent) {
      if (typeof o.userData.instanceId === 'string') return o.userData.instanceId;
      if (o === this.root) break;
    }
    return null;
  }

  /** Meshes belonging to parts (excludes helper objects added by callers, e.g. markers). */
  pickableMeshes(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.helper) out.push(o);
    });
    return out;
  }

  /** Detaches all scene objects. Geometry/materials stay in the shared cache. */
  clear(): void {
    this.root.clear();
    this.instanceNodes.clear();
    this.socketNodes.clear();
  }
}
