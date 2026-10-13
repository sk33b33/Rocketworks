import * as THREE from 'three';
import type { HullFinish } from '../../rocket/model/types';
import { createSootTexture, createTileTexture } from '../proceduralTextures';
import type { ResourceCache } from '../ResourceCache';

/** Shared rocket materials, created lazily through the scene's resource cache. */
export interface RocketMaterials {
  steel: THREE.MeshStandardMaterial;
  steelSeam: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  bell: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  tile: THREE.MeshStandardMaterial;
  titanium: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  solar: THREE.MeshStandardMaterial;
}

/** Stainless hull parameters per cosmetic finish. */
function hullParams(
  cache: ResourceCache,
  finish: HullFinish,
): THREE.MeshStandardMaterialParameters {
  switch (finish) {
    case 'polished':
      return { color: 0xdfe3e8, metalness: 1, roughness: 0.12 };
    case 'weathered':
      return {
        color: 0xb5ada3,
        metalness: 0.85,
        roughness: 0.5,
        map: cache.texture('rocket:sootTex', createSootTexture),
      };
    default:
      return { color: 0xc9ced4, metalness: 0.92, roughness: 0.3 };
  }
}

export function getRocketMaterials(
  cache: ResourceCache,
  finish: HullFinish = 'brushed',
): RocketMaterials {
  const std = (key: string, params: THREE.MeshStandardMaterialParameters) =>
    cache.material(`rocket:${key}`, () => new THREE.MeshStandardMaterial(params));
  return {
    steel: std(`steel:${finish}`, hullParams(cache, finish)),
    steelSeam: std(`steelSeam:${finish}`, {
      color: finish === 'weathered' ? 0x6f6a64 : 0x8d949c,
      metalness: 0.9,
      roughness: finish === 'polished' ? 0.25 : 0.45,
    }),
    darkMetal: std('darkMetal', { color: 0x2f3237, metalness: 0.7, roughness: 0.5 }),
    bell: std('bell', {
      color: 0x3a3c41,
      metalness: 0.85,
      roughness: 0.38,
      side: THREE.DoubleSide,
    }),
    copper: std('copper', { color: 0xa0603a, metalness: 0.9, roughness: 0.35 }),
    tile: std('tile', {
      color: 0xffffff,
      map: cache.texture('rocket:tileTex', createTileTexture),
      metalness: 0.05,
      roughness: 0.92,
    }),
    titanium: std('titanium', { color: 0x5b6067, metalness: 0.8, roughness: 0.42 }),
    glass: std('glass', {
      color: 0x0a1420,
      emissive: 0x3a5a7a,
      emissiveIntensity: 0.35,
      metalness: 0.4,
      roughness: 0.08,
    }),
    accent: std('accent', { color: 0xe9e9e4, metalness: 0.1, roughness: 0.6 }),
    solar: std('solar', { color: 0x1b2a55, metalness: 0.6, roughness: 0.25 }),
  };
}
