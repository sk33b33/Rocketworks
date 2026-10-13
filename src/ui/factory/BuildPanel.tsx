import { useGameStore } from '../../app/gameStore';
import { CatalogPanel } from './CatalogPanel';
import { StructurePanel } from './StructurePanel';

/** Left-hand build area: 3D-oriented parts catalog or the list-based structure view. */
export function BuildPanel() {
  const mode = useGameStore((s) => s.ui.assemblyMode);
  const setMode = useGameStore((s) => s.setAssemblyMode);
  return (
    <div className="panel build">
      <div className="tabs" role="tablist" aria-label="Assembly mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'catalog'}
          onClick={() => setMode('catalog')}
        >
          Parts catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'structure'}
          onClick={() => setMode('structure')}
        >
          Structure list
        </button>
      </div>
      <div className="tab-body" role="tabpanel">
        {mode === 'catalog' ? <CatalogPanel /> : <StructurePanel />}
      </div>
    </div>
  );
}
