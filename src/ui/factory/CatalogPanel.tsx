import { useMemo, useState } from 'react';
import { selectGuide, selectProgram, useGameStore } from '../../app/gameStore';
import { compatibleTargets } from '../../rocket/assembly/compatibility';
import { CATEGORY_LABELS, PARTS } from '../../rocket/catalog/parts';
import type { PartCategory } from '../../rocket/model/types';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { formatCredits, formatMass } from '../format';
import { usePartAccess } from './usePartAccess';

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PartCategory[];

/** Browsable parts catalog. Selecting a part highlights where it can attach. */
export function CatalogPanel() {
  const blueprint = useGameStore((s) => s.blueprint);
  const selection = useGameStore((s) => s.selection);
  const select = useGameStore((s) => s.selectCatalogPart);
  const guide = useGameStore(selectGuide);
  const program = useGameStore(selectProgram);
  const access = usePartAccess();
  const [filter, setFilter] = useState('');

  const slotCounts = useMemo(
    () =>
      new Map(
        PARTS.map((p) => [
          p.id,
          compatibleTargets(blueprint, p.id, program.unlockedPartIds).length,
        ]),
      ),
    [blueprint, program.unlockedPartIds],
  );
  const remaining = program.budgetCredits - calculateRocketStats(blueprint).costCredits;
  const suggested = new Set(guide.currentStep?.partIds ?? []);
  const q = filter.trim().toLowerCase();
  const visible = PARTS.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      CATEGORY_LABELS[p.category].toLowerCase().includes(q),
  );

  return (
    <div className="catalog">
      <div className="panel-header">
        <h2 className="sr-only">Parts catalog</h2>
        <span className="muted">{PARTS.length} parts</span>
        <span
          className={`spacer ${remaining < 0 ? 'tone-bad' : 'muted'}`}
          title="Program budget left for this design"
        >
          {formatCredits(remaining)} left
        </span>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Filter parts…"
        aria-label="Filter parts"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="catalog-list">
        {CATEGORY_ORDER.map((cat) => {
          const parts = visible.filter((p) => p.category === cat);
          if (!parts.length) return null;
          return (
            <section key={cat} aria-label={CATEGORY_LABELS[cat]}>
              <h3 className="eyebrow">{CATEGORY_LABELS[cat]}</h3>
              <ul>
                {parts.map((p) => {
                  const active = selection?.kind === 'catalog' && selection.partId === p.id;
                  const slots = slotCounts.get(p.id) ?? 0;
                  const lockReason = access.lockReason(p);
                  const unaffordable = !lockReason && p.costCredits > remaining;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`part-card ${active ? 'active' : ''} ${lockReason ? 'locked' : ''}`}
                        aria-pressed={active}
                        onClick={() => select(p.id)}
                        title={lockReason ?? p.description}
                      >
                        <span className="part-card-name">
                          {lockReason && <span aria-hidden="true">🔒 </span>}
                          {p.name}
                          {lockReason && <span className="sr-only"> (locked)</span>}
                        </span>
                        <span className="part-card-meta">
                          {formatMass(p.dryMassKg)}
                          <span className={unaffordable ? 'tone-bad' : ''}>
                            {formatCredits(p.costCredits)}
                            {unaffordable && ' ✕'}
                          </span>
                          {!lockReason && (
                            <span className={slots ? 'slots' : 'slots none'}>
                              {slots ? `${slots} slot${slots > 1 ? 's' : ''}` : 'no slot'}
                            </span>
                          )}
                          {suggested.has(p.id) && !lockReason && (
                            <span className="badge">Next</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {visible.length === 0 && <p className="muted">No parts match “{filter}”.</p>}
      </div>
    </div>
  );
}
