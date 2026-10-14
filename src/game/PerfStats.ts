/*
 * Lightweight frame statistics for the optional performance readout and automated checks:
 * rolling averages of frame interval, CPU time per frame (scene update + render submission),
 * and the renderer's draw calls and live GPU resources.
 */

export interface PerfSnapshot {
  readonly fps: number;
  readonly frameMs: number;
  readonly updateMs: number;
  readonly renderMs: number;
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly scene: string | null;
}

const ALPHA = 0.05;

export class PerfStats {
  private s: PerfSnapshot = {
    fps: 0,
    frameMs: 0,
    updateMs: 0,
    renderMs: 0,
    calls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    scene: null,
  };

  record(
    deltaS: number,
    updateMs: number,
    renderMs: number,
    info: {
      render: { calls: number; triangles: number };
      memory: { geometries: number; textures: number };
    },
    scene: string | null,
  ): void {
    const ema = (prev: number, x: number) => (prev === 0 ? x : prev + (x - prev) * ALPHA);
    const frameMs = ema(this.s.frameMs, deltaS * 1000);
    this.s = {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      updateMs: ema(this.s.updateMs, updateMs),
      renderMs: ema(this.s.renderMs, renderMs),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      scene,
    };
  }

  get current(): PerfSnapshot {
    return this.s;
  }
}

/** The running game's statistics (null before the 3D view starts). */
export const perfProbe: { stats: PerfStats | null } = { stats: null };
