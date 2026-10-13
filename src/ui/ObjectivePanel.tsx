import { useGameStore } from '../app/gameStore';
import { getObjective } from '../app/gameState';
import { getLocation } from '../app/locations';

export function ObjectivePanel() {
  const currentLocation = useGameStore((s) => s.currentLocation);
  const saveVersion = useGameStore((s) => s.saveVersion);
  const objective = getObjective({ currentLocation, saveVersion });
  const pct = Math.round(objective.progress * 100);

  return (
    <aside className="panel objective" aria-label="Current objective">
      <div className="eyebrow">Location</div>
      <div className="location-name">{getLocation(currentLocation).name}</div>
      <div className="eyebrow">Objective</div>
      <p>{objective.title}</p>
      <div className="eyebrow">Next</div>
      <p>{objective.nextAction}</p>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="placeholder-note">Stage 0 scaffold: temporary placeholder scene.</p>
    </aside>
  );
}
