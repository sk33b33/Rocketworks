import type { EvaKey } from '../src/flight/flightRuntime';
import { nearestOpen, type EvaState } from '../src/surface/eva';

/** What the EVA walker needs from a runtime. */
export interface EvaDriver {
  readonly evaState: EvaState | null;
  setEvaKey(key: EvaKey, down: boolean): void;
  update(realDtS: number): void;
}

const release = (rt: EvaDriver) => {
  for (const k of ['forward', 'back', 'left', 'right', 'collect'] as const) rt.setEvaKey(k, false);
};

/**
 * Walks the astronaut like a player would: turn toward the target, walk, and side-step when
 * something blocks the way. Returns when within `reachM` (or the EVA ends).
 */
export function walkTo(rt: EvaDriver, x: number, z: number, reachM: number, maxFrames = 20_000) {
  let stuck = 0;
  let detour = 0;
  for (let i = 0; i < maxFrames; i++) {
    const e = rt.evaState;
    if (!e || e.phase !== 'out') break;
    const d = Math.hypot(x - e.x, z - e.z);
    if (d <= reachM) break;
    release(rt);
    if (detour > 0) {
      detour--;
      rt.setEvaKey('forward', true);
      rt.setEvaKey('left', detour > 25);
    } else {
      const want = Math.atan2(z - e.z, x - e.x);
      const err = Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading));
      if (Math.abs(err) > 0.15) rt.setEvaKey(err > 0 ? 'left' : 'right', true);
      if (Math.abs(err) < 0.6) rt.setEvaKey('forward', true);
    }
    const before = { x: e.x, z: e.z };
    rt.update(0.1);
    const after = rt.evaState;
    if (after && Math.abs(after.x - before.x) + Math.abs(after.z - before.z) < 1e-6 && detour === 0)
      stuck++;
    else stuck = 0;
    if (stuck > 15) {
      detour = 40;
      stuck = 0;
    }
  }
  release(rt);
}

/** Collects every sample in turn (walking to each), then walks back to the ship. */
export function collectAll(rt: EvaDriver, reachM: number, boardM: number) {
  for (let n = 0; n < 10; n++) {
    const e = rt.evaState;
    if (!e) return;
    const target = nearestOpen(e);
    if (!target) break;
    walkTo(rt, target.x, target.z, reachM * 0.8);
    rt.setEvaKey('collect', true);
    for (let i = 0; i < 200 && (nearestOpen(rt.evaState!, reachM)?.id ?? null) === target.id; i++)
      rt.update(0.1);
    rt.setEvaKey('collect', false);
  }
  const e = rt.evaState;
  if (e) walkTo(rt, e.shipX, e.shipZ, boardM * 0.7);
}
