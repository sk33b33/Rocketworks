import { useState } from 'react';
import { useGameStore } from '../../app/gameStore';
import {
  compatibleTargets,
  describeSocket,
  findInstance,
} from '../../rocket/assembly/compatibility';
import { subtreeIds } from '../../rocket/assembly/operations';
import { getPart, PARTS } from '../../rocket/catalog/parts';
import { useShortcut } from '../useShortcut';
import { PartFacts } from './PartFacts';
import { usePartAccess } from './usePartAccess';

const MAX_LISTED_TARGETS = 24;

function CatalogSelection({ partId }: { partId: string }) {
  const blueprint = useGameStore((s) => s.blueprint);
  const attach = useGameStore((s) => s.attachSelectedTo);
  const fill = useGameStore((s) => s.fillSelected);
  const clear = useGameStore((s) => s.clearSelection);
  const access = usePartAccess();
  const part = getPart(partId);
  const lockReason = access.lockReason(part);
  const targets = lockReason ? [] : compatibleTargets(blueprint, partId, access.unlocked);
  const disabledReason = lockReason
    ? 'This part is locked.'
    : targets.length === 0
      ? 'No free compatible attachment point on the current build.'
      : undefined;

  return (
    <>
      <PartFacts part={part} />
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={fill}
          disabled={!!disabledReason}
          title={disabledReason}
        >
          {targets.length > 1 ? `Fill all ${targets.length} slots` : 'Attach'}
        </button>
        <button type="button" onClick={clear}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
      {disabledReason ? (
        <p className="hint" role="note">
          {disabledReason}
        </p>
      ) : (
        <>
          <p className="hint">Click a green marker on the rocket, or choose an attachment point:</p>
          <ul className="target-list">
            {targets.slice(0, MAX_LISTED_TARGETS).map((t) => (
              <li key={`${t.ref.parentId}/${t.ref.socketId}`}>
                <button type="button" onClick={() => attach(t.ref)}>
                  {describeSocket(blueprint, t.ref)}
                </button>
              </li>
            ))}
          </ul>
          {targets.length > MAX_LISTED_TARGETS && (
            <p className="muted">…and {targets.length - MAX_LISTED_TARGETS} more.</p>
          )}
        </>
      )}
    </>
  );
}

function InstanceSelection({ instanceId }: { instanceId: string }) {
  const blueprint = useGameStore((s) => s.blueprint);
  const remove = useGameStore((s) => s.removeInstance);
  const rotate = useGameStore((s) => s.rotateInstance);
  const replace = useGameStore((s) => s.replaceInstance);
  const clear = useGameStore((s) => s.clearSelection);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const access = usePartAccess();
  const [confirming, setConfirming] = useState(false);
  const [confirmFor, setConfirmFor] = useState(instanceId);
  if (confirmFor !== instanceId) {
    setConfirmFor(instanceId);
    setConfirming(false);
  }

  const inst = findInstance(blueprint, instanceId);
  const part = inst ? getPart(inst.partId) : null;
  const subtree = inst ? subtreeIds(blueprint, instanceId).length : 0;
  const rotationReason =
    part && !part.rotationStepDeg ? `${part.name} has a fixed orientation.` : undefined;

  const requestRemove = () => {
    if (!inst) return;
    if (subtree > 1 && !confirming) setConfirming(true);
    else remove(instanceId);
  };
  useShortcut(['Delete', 'Backspace'], requestRemove, !!inst);
  useShortcut(['r', 'R'], () => !rotationReason && rotate(instanceId), !!inst);
  useShortcut(['f', 'F'], () => requestCamera('focus', instanceId), !!inst);

  if (!inst || !part) return null;
  const alternatives = PARTS.filter((p) => p.attachesTo === part.attachesTo && p.id !== part.id);

  return (
    <>
      <PartFacts part={part} />
      <dl className="facts">
        <dt>Installed on</dt>
        <dd>{describeSocket(blueprint, inst.parent)}</dd>
        <dt>Orientation</dt>
        <dd>{inst.rotationDeg}°</dd>
        <dt>Carries</dt>
        <dd>{subtree - 1} attached part(s)</dd>
      </dl>
      <div className="actions">
        <button type="button" onClick={() => requestCamera('focus', instanceId)}>
          Focus <kbd>F</kbd>
        </button>
        <button
          type="button"
          onClick={() => rotate(instanceId)}
          disabled={!!rotationReason}
          title={rotationReason}
        >
          Rotate <kbd>R</kbd>
        </button>
        <button type="button" className="danger" onClick={requestRemove}>
          Remove <kbd>Del</kbd>
        </button>
        <button type="button" onClick={clear}>
          Deselect <kbd>Esc</kbd>
        </button>
      </div>
      {rotationReason && <p className="hint">{rotationReason}</p>}
      {confirming && (
        <div className="confirm" role="alertdialog" aria-label="Confirm removal">
          <p>
            Remove {part.name} and the {subtree - 1} part(s) attached to it?
          </p>
          <div className="actions">
            <button type="button" className="danger" autoFocus onClick={() => remove(instanceId)}>
              Remove {subtree} parts
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      )}
      {alternatives.length > 0 && (
        <>
          <div className="eyebrow section-gap">Replace with</div>
          <ul className="target-list">
            {alternatives.map((alt) => {
              const reason = access.lockReason(alt);
              return (
                <li key={alt.id}>
                  <button
                    type="button"
                    onClick={() => replace(instanceId, alt.id)}
                    disabled={!!reason}
                    title={reason}
                  >
                    {reason ? '🔒 ' : ''}
                    {alt.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** Details and actions for whatever is selected. */
export function InspectorPanel() {
  const selection = useGameStore((s) => s.selection);
  const clear = useGameStore((s) => s.clearSelection);
  useShortcut(['Escape'], clear, selection !== null);

  return (
    <div className="panel inspector" aria-live="polite">
      <div className="panel-header">
        <h2>
          {selection?.kind === 'instance'
            ? 'Installed part'
            : selection
              ? 'Selected part'
              : 'Inspector'}
        </h2>
      </div>
      {selection === null && (
        <p className="muted">
          Pick a part from the catalog to see where it fits, or click a part on the rocket to
          inspect, rotate, replace or remove it.
        </p>
      )}
      {selection?.kind === 'catalog' && <CatalogSelection partId={selection.partId} />}
      {selection?.kind === 'instance' && <InstanceSelection instanceId={selection.instanceId} />}
    </div>
  );
}
