import type { LocationId } from '../app/locations';
import type { GameScene, SceneContext, SceneFactories } from './GameScene';

/** Creates scenes lazily, runs enter/exit, and disposes scenes it created. */
export class SceneManager {
  private readonly scenes = new Map<LocationId, GameScene>();
  private active: GameScene | null = null;
  private size = { width: 1, height: 1 };

  constructor(
    private readonly context: SceneContext,
    private readonly factories: SceneFactories,
  ) {}

  get activeScene(): GameScene | null {
    return this.active;
  }

  /** Returns false (and keeps the current scene) when the location has no scene yet. */
  switchTo(id: LocationId): boolean {
    if (this.active?.id === id) return true;
    const factory = this.factories[id];
    if (!factory) return false;

    let next = this.scenes.get(id);
    if (!next) {
      next = factory();
      next.create(this.context);
      this.scenes.set(id, next);
    }
    const previous = this.active;
    previous?.exit(id);
    next.resize(this.size.width, this.size.height);
    next.enter(previous?.id ?? null);
    this.active = next;
    return true;
  }

  update(deltaSeconds: number): void {
    this.active?.update(deltaSeconds);
  }

  resize(width: number, height: number): void {
    this.size = { width, height };
    this.active?.resize(width, height);
  }

  dispose(): void {
    this.active?.exit(null);
    this.active = null;
    for (const scene of this.scenes.values()) scene.dispose();
    this.scenes.clear();
  }
}
