import { useEffect, useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { useShortcut } from '../useShortcut';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function CameraToolbar() {
  const selection = useGameStore((s) => s.selection);
  const canUndo = useGameStore((s) => s.history.past.length > 0);
  const canRedo = useGameStore((s) => s.history.future.length > 0);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const [help, setHelp] = useState(false);
  const selectedId = selection?.kind === 'instance' ? selection.instanceId : null;
  useShortcut(['c', 'C'], () => requestCamera('reset'));
  useShortcut(['?'], () => setHelp((h) => !h));

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="camera-toolbar">
      {help && (
        <div className="panel help" role="dialog" aria-label="Controls">
          <dl className="facts">
            <dt>Orbit</dt>
            <dd>Left-drag · one-finger drag · arrow keys (canvas focused)</dd>
            <dt>Pan</dt>
            <dd>Right-drag · two-finger drag · Shift + arrows</dd>
            <dt>Zoom</dt>
            <dd>Wheel · pinch · + / −</dd>
            <dt>Select</dt>
            <dd>Click a part or a marker, or use the Structure list</dd>
            <dt>Edit</dt>
            <dd>Ctrl+Z undo · Ctrl+Shift+Z / Ctrl+Y redo</dd>
            <dt>Shortcuts</dt>
            <dd>Esc deselect · Del remove · R rotate · F focus · C reset camera · ? help</dd>
          </dl>
        </div>
      )}
      <div className="toolbar">
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
          aria-label="Undo"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          title={canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo'}
          aria-label="Redo"
        >
          ↷ Redo
        </button>
        <button type="button" onClick={() => requestCamera('reset')}>
          Reset camera <kbd>C</kbd>
        </button>
        <button
          type="button"
          onClick={() => selectedId && requestCamera('focus', selectedId)}
          disabled={!selectedId}
          title={selectedId ? undefined : 'Select a part on the rocket to focus on it.'}
        >
          Focus <kbd>F</kbd>
        </button>
        <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}>
          Controls <kbd>?</kbd>
        </button>
      </div>
    </div>
  );
}
