import { useGameStore } from '../../app/gameStore';
import { buildLaunchContext } from '../../app/launchBinding';
import { CountdownPanel } from './CountdownPanel';
import { DebriefPanel } from './DebriefPanel';
import { LaunchControls } from './LaunchControls';
import { TelemetryPanel } from './TelemetryPanel';
import { useLaunchSnapshot } from './useLaunch';

/** Launch Pad overlay: empty state, countdown checklist, telemetry, controls and debrief. */
export function LaunchPadHud() {
  const snap = useLaunchSnapshot();
  const goTo = useGameStore((s) => s.goTo);
  const reason = useGameStore((s) => {
    const r = buildLaunchContext(s);
    return r.ok ? null : r.reason;
  });

  if (snap.phase === 'idle') {
    return (
      <div className="factory-hud launch-hud">
        <div className="panel empty-pad" role="status">
          <h2>The pad is clear</h2>
          <p>{reason ?? 'Preparing rollout…'}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => goTo('mission-control')}>
              Go to Mission Control
            </button>
          </div>
        </div>
        <LaunchControls snap={snap} />
      </div>
    );
  }

  return (
    <div className="factory-hud launch-hud">
      <div className="hud-col hud-left">
        <section data-panel="countdown" className="grow">
          <CountdownPanel snap={snap} />
        </section>
      </div>
      <div className="hud-col hud-right">
        <section data-panel="telemetry" className="grow">
          {snap.phase === 'ascent' ||
          ((snap.phase === 'debrief' || snap.phase === 'handoff') && snap.ascent) ? (
            <TelemetryPanel snap={snap} />
          ) : (
            <div className="panel">
              <div className="eyebrow">Status</div>
              <p>
                {snap.phase === 'rollout'
                  ? 'The transporter is moving the stack to the pad. The tower arms will lift it onto the mount.'
                  : snap.phase === 'pad'
                    ? 'Vehicle stacked on the mount. Start the countdown when ready.'
                    : 'Countdown in progress. Telemetry starts at liftoff.'}
              </p>
            </div>
          )}
        </section>
      </div>
      {snap.phase === 'debrief' && snap.record && <DebriefPanel record={snap.record} />}
      <LaunchControls snap={snap} />
    </div>
  );
}
