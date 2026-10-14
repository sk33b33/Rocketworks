import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../app/gameStore';
import { UI_SCALES } from '../persistence/saveGame';

/** Interface settings in the top bar: motion, size, flight failures, and the program overview. */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ui = useGameStore((s) => s.ui);
  const setReduceMotion = useGameStore((s) => s.setReduceMotion);
  const setUiScale = useGameStore((s) => s.setUiScale);
  const setRandomFailures = useGameStore((s) => s.setRandomFailures);
  const setOverviewSeen = useGameStore((s) => s.setOverviewSeen);
  const showPerf = useGameStore((s) => s.showPerf);
  const setShowPerf = useGameStore((s) => s.setShowPerf);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button
        type="button"
        className="settings-toggle"
        aria-expanded={open}
        aria-controls="settings-panel"
        onClick={() => setOpen((o) => !o)}
      >
        Settings
      </button>
      {open && (
        <div
          id="settings-panel"
          className="panel settings-panel"
          role="dialog"
          aria-label="Settings"
        >
          <h2>Settings</h2>
          <label className="inline-check">
            <input
              type="checkbox"
              autoFocus
              checked={ui.reduceMotion}
              onChange={(e) => setReduceMotion(e.target.checked)}
            />
            Reduce motion
          </label>
          <p className="small-text muted">
            No automatic camera orbits, flashing lights or flicker; interface transitions off.
          </p>
          <fieldset className="scale-picker">
            <legend className="eyebrow">Interface size</legend>
            {UI_SCALES.map((scale) => (
              <label key={scale}>
                <input
                  type="radio"
                  name="ui-scale"
                  checked={ui.uiScale === scale}
                  onChange={() => setUiScale(scale)}
                />
                {Math.round(scale * 100)}%
              </label>
            ))}
          </fieldset>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={ui.randomFailures}
              onChange={(e) => setRandomFailures(e.target.checked)}
            />
            Random flight failures
          </label>
          <p className="small-text muted">Mission risk can cause engine-outs or vehicle loss.</p>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={showPerf}
              onChange={(e) => setShowPerf(e.target.checked)}
            />
            Show performance stats
          </label>
          <div className="actions section-gap">
            <button
              type="button"
              onClick={() => {
                setOverviewSeen(false);
                setOpen(false);
              }}
            >
              Show the program overview
            </button>
          </div>
          <p className="small-text muted">
            Each location lists its keys under Controls (?). Progress saves automatically, including
            flights in progress.
          </p>
        </div>
      )}
    </div>
  );
}
