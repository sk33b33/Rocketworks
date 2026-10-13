import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCompleteStarterDesign } from '../src/rocket/catalog/blueprints';
import { PARTS } from '../src/rocket/catalog/parts';
import { BlueprintRenderer } from '../src/render/rocket/BlueprintRenderer';
import { buildPartObject, PART_RECIPES } from '../src/render/rocket/partRecipes';
import { getRocketMaterials } from '../src/render/rocket/rocketMaterials';
import { ResourceCache } from '../src/render/ResourceCache';

const NOW = '2026-01-01T00:00:00.000Z';

describe('rocket rendering adapter', () => {
  it('has a procedural recipe for every catalog part', () => {
    const cache = new ResourceCache();
    for (const part of PARTS) {
      expect(PART_RECIPES[part.visual], part.id).toBeDefined();
      const obj = buildPartObject({ part, cache, mats: getRocketMaterials(cache) });
      let meshes = 0;
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes, part.id).toBeGreaterThan(0);
    }
    cache.dispose();
  });

  it('renders every instance as its own group mapped back to its id', () => {
    const cache = new ResourceCache();
    const renderer = new BlueprintRenderer(cache);
    const bp = createCompleteStarterDesign(NOW);
    renderer.build(bp);
    for (const inst of bp.parts) {
      const node = renderer.getInstanceNode(inst.id);
      expect(node, inst.id).toBeDefined();
      const mesh = node!.children[0]!.getObjectByProperty('isMesh', true) ?? node!.children[0]!;
      expect(renderer.instanceIdOf(mesh)).toBe(inst.id);
    }
    // The nose sits far above the stand: transforms compose through the attachment graph.
    const nose = bp.parts.find((p) => p.partId === 'nose-cone')!;
    const pos = renderer.getInstanceNode(nose.id)!.getWorldPosition(new THREE.Vector3());
    expect(pos.y).toBeGreaterThan(60);
    // Engines hang below the booster engine section.
    const engine = bp.parts.find((p) => p.partId === 'engine-sl')!;
    const bell = new THREE.Box3().setFromObject(renderer.getInstanceNode(engine.id)!);
    expect(bell.min.y).toBeLessThan(0);
  });

  it('shares GPU resources across rebuilds (no growth)', () => {
    const cache = new ResourceCache();
    const renderer = new BlueprintRenderer(cache);
    const bp = createCompleteStarterDesign(NOW);
    renderer.build(bp);
    const size = cache.size;
    for (let i = 0; i < 5; i++) renderer.build(bp);
    expect(cache.size).toBe(size);
    renderer.clear();
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});
