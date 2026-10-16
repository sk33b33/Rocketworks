import { useEffect, useRef } from 'react';
import { useGameStore } from '../app/gameStore';
import { usePhotoStore } from '../app/photoStore';
import { LOCATIONS } from '../app/locations';
import { useShortcut } from './useShortcut';

/** Top-bar button that opens photo mode (also the P key anywhere). */
export function PhotoButton() {
  const toggle = usePhotoStore((s) => s.toggle);
  useShortcut(['p', 'P'], toggle);
  return (
    <button
      type="button"
      className="settings-toggle"
      title="Photo mode: hide the interface, frame the shot and save a PNG (P)"
      onClick={toggle}
    >
      Photo
    </button>
  );
}

/**
 * Photo mode: the interface is hidden, dragging orbits the camera around what's at the centre of
 * the view, the wheel zooms, and the bar takes the picture. The simulation keeps running.
 */
export function PhotoMode() {
  const active = usePhotoStore((s) => s.active);
  const close = usePhotoStore((s) => s.close);
  const location = useGameStore((s) => s.currentLocation);

  // A different location means a different scene: leave photo mode.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    usePhotoStore.getState().close();
  }, [location]);

  useShortcut(['Escape'], close, active);
  if (!active) return null;
  return <PhotoControls />;
}

function PhotoControls() {
  const move = usePhotoStore((s) => s.move);
  const home = usePhotoStore((s) => s.home);
  const close = usePhotoStore((s) => s.close);
  const take = usePhotoStore((s) => s.take);
  const message = usePhotoStore((s) => s.message);
  const location = useGameStore((s) => s.currentLocation);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  useShortcut(['ArrowLeft'], () => move(-30, 0));
  useShortcut(['ArrowRight'], () => move(30, 0));
  useShortcut(['ArrowUp'], () => move(0, -30));
  useShortcut(['ArrowDown'], () => move(0, 30));
  useShortcut(['+', '='], () => move(0, 0, -1));
  useShortcut(['-', '_'], () => move(0, 0, 1));

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      move(0, 0, e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [move]);

  const name = LOCATIONS.find((l) => l.id === location)?.name ?? location;
  return (
    <div className="photo-ui">
      <div
        ref={layer}
        className="photo-layer"
        aria-hidden="true"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          move(e.clientX - drag.current.x, e.clientY - drag.current.y);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <div className="panel photo-bar" role="toolbar" aria-label="Photo mode">
        <span className="photo-title">PHOTO · {name}</span>
        <button type="button" className="primary" onClick={() => take(location)}>
          Take photo
        </button>
        <button type="button" onClick={home}>
          Reset view
        </button>
        <button type="button" onClick={close}>
          Exit
        </button>
        <span className="small-text muted photo-help">
          Drag or arrow keys to orbit · wheel or +/− to zoom · Space pauses a flight · Esc to exit
        </span>
        {message && (
          <span className="small-text photo-msg" role="status">
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
