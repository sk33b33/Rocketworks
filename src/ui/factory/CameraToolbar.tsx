import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import { useShortcut } from '../useShortcut';

export function CameraToolbar() {
  const selection = useGameStore((s) => s.selection);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const [help, setHelp] = useState(false);
  const selectedId = selection?.kind === 'instance' ? selection.instanceId : null;
  useShortcut(['c', 'C'], () => requestCamera('reset'));
  useShortcut(['?'], () => setHelp((h) => !h));

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
            <dd>Click a part or a marker</dd>
            <dt>Shortcuts</dt>
            <dd>Esc deselect · Del remove · R rotate · F focus · C reset camera · ? help</dd>
          </dl>
        </div>
      )}
      <div className="toolbar">
        <button type="button" onClick={() => requestCamera('reset')}>
          Reset camera <kbd>C</kbd>
        </button>
        <button
          type="button"
          onClick={() => selectedId && requestCamera('focus', selectedId)}
          disabled={!selectedId}
          title={selectedId ? undefined : 'Select a part on the rocket to focus on it.'}
        >
          Focus selected <kbd>F</kbd>
        </button>
        <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}>
          Controls <kbd>?</kbd>
        </button>
      </div>
    </div>
  );
}
