import { create } from 'zustand';
import { adjustPhotoView, PHOTO_HOME, type PhotoView } from '../game/photoCamera';

/*
 * Photo mode: transient interface state (never saved). The 3D runtime reads the view; taking a
 * photo goes through a capture function the viewport registers (it owns the renderer).
 */

type Capture = () => string | null;
let capture: Capture | null = null;

/** Registers the renderer's PNG capture (the viewport does this; null when it goes away). */
export function registerPhotoCapture(fn: Capture | null): void {
  capture = fn;
}

export interface PhotoStore {
  readonly active: boolean;
  readonly view: PhotoView;
  readonly shots: number;
  readonly message: string | null;
  open(): void;
  close(): void;
  toggle(): void;
  move(dxPx: number, dyPx: number, wheelSteps?: number): void;
  home(): void;
  /** Renders the current view and downloads it as a PNG. */
  take(location: string): boolean;
}

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  active: false,
  view: PHOTO_HOME,
  shots: 0,
  message: null,
  open: () => set({ active: true, view: PHOTO_HOME, message: null }),
  close: () => set({ active: false, message: null }),
  toggle: () => (get().active ? get().close() : get().open()),
  move: (dx, dy, wheel = 0) => set((s) => ({ view: adjustPhotoView(s.view, dx, dy, wheel) })),
  home: () => set({ view: PHOTO_HOME }),
  take: (location) => {
    const url = capture?.() ?? null;
    if (!url) {
      set({ message: 'Could not capture the view (the 3D view is not running).' });
      return false;
    }
    const name = photoFileName(location, new Date());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    set((s) => ({ shots: s.shots + 1, message: `Saved ${name}` }));
    return true;
  },
}));

/** File name for a photo, e.g. rocketworks-flight-2026-10-16-14-05-09.png. Pure. */
export function photoFileName(location: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}-${p(at.getMinutes())}-${p(at.getSeconds())}`;
  return `rocketworks-${location}-${stamp}.png`;
}
