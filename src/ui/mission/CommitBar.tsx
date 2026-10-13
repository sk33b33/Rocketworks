import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { commitState } from '../../missions/missionReadiness';
import { useShortcut } from '../useShortcut';

/** Commit / stand-down controls and camera reset for Mission Control. */
export function CommitBar() {
  const report = useGameStore(selectMissionReport);
  const setup = useGameStore((s) => s.mission);
  const bp = useGameStore((s) => s.blueprints.find((b) => b.id === s.mission.designId));
  const commit = useGameStore((s) => s.commitMission);
  const standDown = useGameStore((s) => s.standDown);
  const requestCamera = useGameStore((s) => s.requestCamera);
  const setTab = useGameStore((s) => s.setMissionTab);
  useShortcut(['c', 'C'], () => requestCamera('reset'));
  const state = commitState(setup, bp, report);
  const critical = report.issues.filter((i) => i.severity === 'critical').length;
  const reason = critical ? `${critical} critical item(s) open. See Readiness.` : undefined;

  return (
    <div className="camera-toolbar commit-bar">
      {state === 'void' && (
        <div className="panel commit-note tone-warn" role="status">
          ! The commitment is void: the vehicle changed or the poll is no longer GO. Re-commit when
          ready.
        </div>
      )}
      <div className="toolbar">
        {state === 'committed' ? (
          <>
            <span className="committed">
              ✓ Committed · awaiting rollout (Launch Pad opens next stage)
            </span>
            <button type="button" onClick={standDown}>
              Stand down
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              onClick={commit}
              disabled={!!reason}
              title={reason}
            >
              Commit mission · GO for rollout
            </button>
            {reason && (
              <button type="button" onClick={() => setTab('readiness')}>
                Why not? ({critical})
              </button>
            )}
          </>
        )}
        <button type="button" onClick={() => requestCamera('reset')}>
          Reset view <kbd>C</kbd>
        </button>
      </div>
    </div>
  );
}
