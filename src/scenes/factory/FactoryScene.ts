import * as THREE from 'three';
import { listTargets, resolveSocket } from '../../rocket/assembly/compatibility';
import { findPart } from '../../rocket/catalog/parts';
import type { SocketRef } from '../../rocket/model/types';
import { BlueprintRenderer } from '../../render/rocket/BlueprintRenderer';
import { ResourceCache } from '../../render/ResourceCache';
import type { GameScene, SceneContext } from '../../game/GameScene';
import { buildAssemblyHall, STAND_HEIGHT_M } from './AssemblyHall';
import { FactoryCamera } from './FactoryCamera';
import type { FactoryController, FactoryView } from './factoryController';
import { SocketMarkers } from './SocketMarkers';

const CLICK_TOLERANCE_PX = 6;

/** Rocket Factory / Assembly Hall: renders the hall and the current blueprint, handles picking. */
export class FactoryScene implements GameScene {
  readonly id = 'factory' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900);

  private readonly cache = new ResourceCache();
  private readonly rocket = new BlueprintRenderer(this.cache);
  private readonly markers = new SocketMarkers(this.cache, this.rocket);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private hall: ReturnType<typeof buildAssemblyHall> | null = null;
  private cameraRig: FactoryCamera | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private selectionBox: THREE.BoxHelper | null = null;
  private hoverBox: THREE.BoxHelper | null = null;
  private unsubscribers: (() => void)[] = [];
  private pointerDown: { x: number; y: number } | null = null;
  private pendingHover: { x: number; y: number } | null = null;
  private hoveredInstance: string | null = null;
  private elapsed = 0;

  constructor(private readonly controller: FactoryController) {}

  create(context: SceneContext): void {
    this.canvas = context.canvas;
    this.hall = buildAssemblyHall(this.scene, context.renderer, this.cache);
    this.rocket.root.position.set(0, STAND_HEIGHT_M, 0);
    this.scene.add(this.rocket.root);
    this.cameraRig = new FactoryCamera(this.camera, context.canvas);
    this.rebuild(this.controller.getView());
  }

  enter(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      '3D assembly hall. Arrow keys orbit, plus and minus zoom, Shift plus arrows pan.',
    );
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.unsubscribers.push(
      this.controller.subscribe((view, prev) => {
        if (view.blueprint !== prev.blueprint) this.rebuild(view);
        else if (view.selection !== prev.selection || view.unlockedPartIds !== prev.unlockedPartIds)
          this.refreshSelection(view);
      }),
      this.controller.subscribeCamera((req) => {
        if (req.kind === 'reset') this.resetCamera(false);
        else if (req.instanceId) this.focusInstance(req.instanceId);
      }),
    );
    this.rebuild(this.controller.getView());
    this.resetCamera(true);
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.hall?.update(deltaSeconds, this.elapsed);
    this.markers.update(deltaSeconds);
    if (this.pendingHover) {
      this.processHover(this.pendingHover);
      this.pendingHover = null;
    }
    this.cameraRig?.update(deltaSeconds);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  exit(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.style.cursor = '';
    }
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
  }

  dispose(): void {
    this.exit();
    this.markers.clear();
    this.setBox('selectionBox', null);
    this.setBox('hoverBox', null);
    this.cameraRig?.dispose();
    this.hall?.dispose();
    this.rocket.clear();
    this.cache.dispose();
    this.scene.clear();
  }

  /** Exposed for debugging/tests: number of cached GPU resources. */
  get resourceCount(): number {
    return this.cache.size;
  }

  // ---------- view sync ----------

  private rebuild(view: FactoryView): void {
    this.rocket.build(view.blueprint);
    this.hoveredInstance = null;
    this.setBox('hoverBox', null);
    this.refreshSelection(view);
  }

  private refreshSelection(view: FactoryView): void {
    const sel = view.selection;
    if (sel?.kind === 'catalog') {
      this.markers.show(listTargets(view.blueprint, sel.partId, view.unlockedPartIds));
    } else {
      this.markers.clear();
    }
    const node = sel?.kind === 'instance' ? this.rocket.getInstanceNode(sel.instanceId) : undefined;
    this.setBox('selectionBox', node?.children[0] ?? null, 0xf0a830);
  }

  private setBox(
    which: 'selectionBox' | 'hoverBox',
    target: THREE.Object3D | null,
    color = 0x8fd3ff,
  ): void {
    const existing = this[which];
    if (existing) {
      existing.removeFromParent();
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
      this[which] = null;
    }
    if (!target) return;
    const helper = new THREE.BoxHelper(target, color);
    helper.userData.helper = true;
    helper.renderOrder = 15;
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    this.scene.add(helper);
    this[which] = helper;
  }

  // ---------- camera ----------

  private resetCamera(immediate: boolean): void {
    const box = new THREE.Box3().setFromObject(this.rocket.root);
    if (box.isEmpty() || box.max.y - box.min.y < 12) {
      // Frame the stand area when the build is small or empty.
      box.union(
        new THREE.Box3(
          new THREE.Vector3(-10, 0, -10),
          new THREE.Vector3(10, STAND_HEIGHT_M + 14, 10),
        ),
      );
    }
    box.min.y = Math.min(box.min.y, 0);
    this.cameraRig?.frame(box, { immediate, resetDirection: true });
  }

  private focusInstance(instanceId: string): void {
    const node = this.rocket.getInstanceNode(instanceId)?.children[0];
    if (!node) return;
    const box = new THREE.Box3().setFromObject(node);
    box.expandByScalar(2);
    this.cameraRig?.frame(box);
  }

  // ---------- picking ----------

  private setPointer(clientX: number, clientY: number): boolean {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect || rect.width === 0) return false;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  private pickInstanceAt(): string | null {
    const hits = this.raycaster.intersectObjects(this.rocket.pickableMeshes(), false);
    return hits.length ? this.rocket.instanceIdOf(hits[0]?.object ?? null) : null;
  }

  private processHover(at: { x: number; y: number }): void {
    if (!this.canvas || !this.setPointer(at.x, at.y)) return;
    const view = this.controller.getView();
    const marker = this.markers.count ? this.markers.pick(this.raycaster) : null;
    if (marker) {
      const part =
        view.selection?.kind === 'catalog' ? (findPart(view.selection.partId) ?? null) : null;
      const span = resolveSocket(view.blueprint, marker.ref)?.socket.span;
      this.markers.setHover(marker.ref, part, span);
      this.setHoverInstance(null);
      this.canvas.style.cursor = marker.valid ? 'copy' : 'not-allowed';
      return;
    }
    this.markers.setHover(null, null);
    const id = this.pickInstanceAt();
    this.setHoverInstance(id);
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
  }

  private setHoverInstance(id: string | null): void {
    if (id === this.hoveredInstance) return;
    this.hoveredInstance = id;
    const sel = this.controller.getView().selection;
    const isSelected = sel?.kind === 'instance' && sel.instanceId === id;
    this.setBox(
      'hoverBox',
      id && !isSelected ? (this.rocket.getInstanceNode(id)?.children[0] ?? null) : null,
    );
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_TOLERANCE_PX) return; // orbit drag
    if (!this.setPointer(e.clientX, e.clientY)) return;
    const marker: { ref: SocketRef; valid: boolean } | null = this.markers.count
      ? this.markers.pick(this.raycaster)
      : null;
    if (marker) {
      this.controller.pickSocket(marker.ref);
      return;
    }
    const id = this.pickInstanceAt();
    if (id) this.controller.pickInstance(id);
    else this.controller.pickNothing();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.pendingHover = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerLeave = (): void => {
    this.pendingHover = null;
    this.markers.setHover(null, null);
    this.setHoverInstance(null);
  };
}
