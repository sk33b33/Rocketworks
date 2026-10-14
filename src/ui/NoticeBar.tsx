import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from '../app/gameStore';

const ICONS = { info: 'ℹ', success: '✓', warning: '⚠' } as const;
const GAP_PX = 10;

/**
 * Keeps the notice clear of the scene's camera/flight toolbar, whose height varies by location,
 * width (it wraps) and interface size. The toolbar sits at the bottom on wide screens and at
 * the top on narrow ones; the notice goes just above or just below it.
 */
function useClearOfToolbar(active: boolean, location: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  useLayoutEffect(() => {
    const notice = ref.current;
    const stage = notice?.parentElement;
    if (!active || !notice || !stage) return;
    const measure = () => {
      const bar = stage.querySelector<HTMLElement>('.camera-toolbar');
      if (!bar) return setStyle(undefined);
      const s = stage.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      // Insets on a zoomed element are in its own (zoomed) units.
      const zoom = parseFloat(getComputedStyle(notice).zoom) || 1;
      const lower = b.top + b.height / 2 > s.top + s.height / 2;
      setStyle(
        lower
          ? { bottom: (s.bottom - b.top + GAP_PX) / zoom, top: 'auto' }
          : { top: (b.bottom - s.top + GAP_PX) / zoom, bottom: 'auto' },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const bar = stage.querySelector('.camera-toolbar');
    if (bar) observer.observe(bar);
    return () => observer.disconnect();
  }, [active, location]);

  return { ref, style };
}

/** Shows the result of the last action, including rejected ones (never fail silently). */
export function NoticeBar() {
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissNotice);
  const location = useGameStore((s) => s.currentLocation);
  const { ref, style } = useClearOfToolbar(!!notice, location);

  useEffect(() => {
    if (!notice || notice.sticky) return;
    const timer = window.setTimeout(dismiss, notice.tone === 'warning' ? 8000 : 4500);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div
      ref={ref}
      style={style}
      className={`notice notice-${notice.tone}`}
      role={notice.tone === 'warning' ? 'alert' : 'status'}
    >
      <span className="notice-icon" aria-hidden="true">
        {ICONS[notice.tone]}
      </span>
      <span>{notice.text}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notice">
        ✕
      </button>
    </div>
  );
}
