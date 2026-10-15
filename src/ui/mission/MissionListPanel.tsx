import { useGameStore } from '../../app/gameStore';
import { missionAvailability, STORY_MISSIONS } from '../../missions/missionCatalog';
import { formatCredits, formatSpeed } from '../format';

/** Mission selector with lock reasons, requirements at a glance and rewards. */
export function MissionListPanel() {
  const current = useGameStore((s) => s.mission.missionId);
  const completed = useGameStore((s) => s.progression.completedMissions);
  const select = useGameStore((s) => s.selectMission);
  return (
    <div className="panel missions">
      <div className="panel-header">
        <h2>Missions</h2>
        <span className="muted">{completed.length} flown</span>
      </div>
      <ul className="mission-list">
        {STORY_MISSIONS.map((m) => {
          const availability = missionAvailability(m, completed);
          const reason = availability.available ? undefined : availability.reason;
          const active = m.id === current;
          const done = completed.includes(m.id);
          const crew =
            m.requirements.maxCrew === 0
              ? 'Uncrewed'
              : `Crew ${m.requirements.minCrew}–${m.requirements.maxCrew}`;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={`mission-card ${active ? 'active' : ''} ${reason ? 'locked' : ''}`}
                aria-pressed={active}
                aria-disabled={reason ? true : undefined}
                title={reason ?? m.summary}
                onClick={() => select(m.id)}
              >
                <span className="mission-name">
                  {reason && <span aria-hidden="true">🔒 </span>}
                  {done && <span aria-hidden="true">✓ </span>}
                  {m.name}
                  {reason && <span className="sr-only"> (locked)</span>}
                </span>
                <span className="muted">
                  {m.destinationLabel} · {crew} ·{' '}
                  {m.durationDays < 1 ? '< 1 d' : `${m.durationDays} d`} · Δv{' '}
                  {formatSpeed(m.requiredDeltaVMs)}
                </span>
                {reason ? (
                  <span className="mission-lock">{reason}</span>
                ) : (
                  <span className="mission-reward">
                    {done
                      ? 'Reward earned'
                      : `Reward +${m.rewardRp} RP, +${formatCredits(m.rewardCredits)} budget`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="footnote">
        Rewards are paid the first time a mission is flown successfully and credited.
      </p>
    </div>
  );
}
