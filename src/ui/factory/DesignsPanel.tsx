import { useState, type FormEvent } from 'react';
import { useGameStore } from '../../app/gameStore';
import { MAX_BLUEPRINTS, MAX_NAME_LENGTH } from '../../rocket/library/blueprintLibrary';
import { HULL_FINISHES } from '../../rocket/model/finish';
import { certificationStatus } from '../../rocket/readiness/certification';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { formatCredits } from '../format';

type Confirm = { kind: 'delete'; id: string } | { kind: 'reset' } | { kind: 'reference' } | null;

const CERT_SHORT = {
  none: '',
  valid: '✓ certified',
  override: '! override',
  expired: 'cert. expired',
} as const;

/** The design library: switch, create, duplicate, rename, delete, finish and resets. */
export function DesignsPanel() {
  const blueprints = useGameStore((s) => s.blueprints);
  const active = useGameStore((s) => s.blueprint);
  const actions = useGameStore.getState();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const full = blueprints.length >= MAX_BLUEPRINTS;
  const fullReason = full
    ? `You can keep up to ${MAX_BLUEPRINTS} designs. Delete one first.`
    : undefined;

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    if (renaming && actions.renameBlueprint(renaming, draft)) setRenaming(null);
  };

  return (
    <div className="designs">
      <ul className="design-list" aria-label="Saved designs">
        {blueprints.map((bp) => {
          const isActive = bp.id === active.id;
          const cert = CERT_SHORT[certificationStatus(bp)];
          return (
            <li key={bp.id} className={isActive ? 'active' : ''}>
              {renaming === bp.id ? (
                <form onSubmit={submitRename} className="rename">
                  <input
                    aria-label="Design name"
                    value={draft}
                    maxLength={MAX_NAME_LENGTH}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                  <button type="submit">Save</button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="design-open"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => actions.switchBlueprint(bp.id)}
                >
                  <span className="design-name">
                    {isActive && <span aria-hidden="true">▸ </span>}
                    {bp.name}
                  </span>
                  <span className="muted">
                    {bp.parts.length} parts · {formatCredits(calculateRocketStats(bp).costCredits)}{' '}
                    · {bp.role}
                    {cert && ` · ${cert}`}
                  </span>
                </button>
              )}
              {renaming !== bp.id && (
                <div className="row-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(bp.id);
                      setDraft(bp.name);
                    }}
                    aria-label={`Rename ${bp.name}`}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.duplicateBlueprint(bp.id)}
                    disabled={full}
                    title={fullReason}
                    aria-label={`Duplicate ${bp.name}`}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setConfirm({ kind: 'delete', id: bp.id })}
                    disabled={blueprints.length <= 1}
                    title={
                      blueprints.length <= 1 ? 'You must keep at least one design.' : undefined
                    }
                    aria-label={`Delete ${bp.name}`}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button type="button" onClick={actions.newBlueprint} disabled={full} title={fullReason}>
          + New design
        </button>
        <span className="muted">
          {blueprints.length}/{MAX_BLUEPRINTS}
        </span>
      </div>

      <fieldset className="finish-picker section-gap">
        <legend className="eyebrow">Hull finish (cosmetic)</legend>
        {HULL_FINISHES.map((f) => (
          <label key={f.id} title={f.description}>
            <input
              type="radio"
              name="finish"
              checked={active.finish === f.id}
              onChange={() => actions.setFinish(f.id)}
            />
            {f.name}
          </label>
        ))}
      </fieldset>

      <div className="eyebrow section-gap">Active design: {active.name}</div>
      {confirm ? (
        <div className="confirm" role="alertdialog" aria-label="Confirm">
          <p>
            {confirm.kind === 'delete'
              ? `Delete "${blueprints.find((b) => b.id === confirm.id)?.name}"? This cannot be undone.`
              : confirm.kind === 'reset'
                ? 'Reset the active design to the starter configuration? (Undo is available.)'
                : 'Replace the active design with the complete reference design? (Undo is available.)'}
          </p>
          <div className="actions">
            <button
              type="button"
              className="danger"
              autoFocus
              onClick={() => {
                if (confirm.kind === 'delete') actions.deleteBlueprint(confirm.id);
                else if (confirm.kind === 'reset') actions.resetBuild();
                else actions.loadReferenceDesign();
                setConfirm(null);
              }}
            >
              {confirm.kind === 'delete' ? 'Delete' : confirm.kind === 'reset' ? 'Reset' : 'Load'}
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setConfirm({ kind: 'reset' })}>
            Reset to starter
          </button>
          <button type="button" onClick={() => setConfirm({ kind: 'reference' })}>
            Load reference design
          </button>
        </div>
      )}
    </div>
  );
}
