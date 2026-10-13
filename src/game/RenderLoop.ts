/** Largest delta passed to scenes; avoids giant jumps after tab suspension or breakpoints. */
export const MAX_FRAME_DELTA_S = 0.1;

export function clampDelta(rawSeconds: number): number {
  if (!Number.isFinite(rawSeconds) || rawSeconds < 0) return 0;
  return Math.min(rawSeconds, MAX_FRAME_DELTA_S);
}

/** Single requestAnimationFrame loop; start() is idempotent so loops can never stack. */
export class RenderLoop {
  private handle: number | null = null;
  private last = 0;

  constructor(private readonly onFrame: (deltaSeconds: number) => void) {}

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (now: number): void => {
    this.handle = requestAnimationFrame(this.tick);
    const delta = clampDelta((now - this.last) / 1000);
    this.last = now;
    this.onFrame(delta);
  };
}
