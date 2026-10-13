import { describe, expect, it } from 'vitest';
import type { LocationId } from '../src/app/locations';
import type { GameScene, SceneContext } from '../src/game/GameScene';
import { SceneManager } from '../src/game/SceneManager';
import { clampDelta, MAX_FRAME_DELTA_S } from '../src/game/RenderLoop';

function fakeScene(id: LocationId, log: string[]): GameScene {
  return {
    id,
    scene: {} as GameScene['scene'],
    camera: {} as GameScene['camera'],
    create: () => log.push(`create:${id}`),
    enter: (prev) => log.push(`enter:${id}<-${prev}`),
    update: (dt) => log.push(`update:${id}:${dt}`),
    resize: () => {},
    exit: (next) => log.push(`exit:${id}->${next}`),
    dispose: () => log.push(`dispose:${id}`),
  };
}

const ctx = {} as SceneContext;

describe('SceneManager', () => {
  it('creates lazily, switches with enter/exit, reuses and disposes once', () => {
    const log: string[] = [];
    const mgr = new SceneManager(ctx, {
      factory: () => fakeScene('factory', log),
      'mission-control': () => fakeScene('mission-control', log),
    });
    expect(mgr.switchTo('factory')).toBe(true);
    expect(mgr.switchTo('factory')).toBe(true);
    mgr.switchTo('mission-control');
    mgr.switchTo('factory');
    mgr.update(0.016);
    mgr.dispose();
    expect(log).toEqual([
      'create:factory',
      'enter:factory<-null',
      'create:mission-control',
      'exit:factory->mission-control',
      'enter:mission-control<-factory',
      'exit:mission-control->factory',
      'enter:factory<-mission-control',
      'update:factory:0.016',
      'exit:factory->null',
      'dispose:factory',
      'dispose:mission-control',
    ]);
    expect(mgr.activeScene).toBeNull();
  });

  it('refuses locations without a scene and keeps the active one', () => {
    const log: string[] = [];
    const mgr = new SceneManager(ctx, { factory: () => fakeScene('factory', log) });
    mgr.switchTo('factory');
    expect(mgr.switchTo('moon')).toBe(false);
    expect(mgr.activeScene?.id).toBe('factory');
  });
});

describe('clampDelta', () => {
  it('caps large deltas and rejects invalid ones', () => {
    expect(clampDelta(0.016)).toBe(0.016);
    expect(clampDelta(5)).toBe(MAX_FRAME_DELTA_S);
    expect(clampDelta(-1)).toBe(0);
    expect(clampDelta(Number.NaN)).toBe(0);
  });
});
