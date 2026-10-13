import type * as THREE from 'three';

/**
 * Keyed cache of GPU resources so identical meshes share geometry/material/texture and everything
 * is released in one dispose() call. Owned by a scene; never shared across scenes.
 */
export class ResourceCache {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly textures = new Map<string, THREE.Texture>();

  geometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geometries.get(key);
    if (!g) {
      g = make();
      this.geometries.set(key, g);
    }
    return g as T;
  }

  material<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.materials.get(key);
    if (!m) {
      m = make();
      this.materials.set(key, m);
    }
    return m as T;
  }

  texture<T extends THREE.Texture>(key: string, make: () => T): T {
    let t = this.textures.get(key);
    if (!t) {
      t = make();
      this.textures.set(key, t);
    }
    return t as T;
  }

  get size(): number {
    return this.geometries.size + this.materials.size + this.textures.size;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}
