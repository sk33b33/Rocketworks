import { useGameStore } from '../../app/gameStore';
import { launchRuntime, syncLaunchWithPlan } from '../../app/launchBinding';
import type { FlightRecord } from '../../launch/flightRecord';
import { findMission } from '../../missions/missionCatalog';
import { RecoveryResultLine } from './RecoveryPanel';

const RESULT = {
  success: { label: '✓ MISSION SUCCESS', tone: 'ok' },
  partial: { label: '✓ ASCENT SUCCESS', tone: 'ok' },
  failure: { label: '✕ MISSION FAILED', tone: 'bad' },
  aborted: { label: '✕ FLIGHT ABORTED', tone: 'bad' },
  scrubbed: { label: '! LAUNCH SCRUBBED', tone: 'warn' },
} as const;

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Post-flight debrief with next steps. */
export function DebriefPanel({ record }: { record: FlightRecord }) {
  const goTo = useGameStore((s) => s.goTo);
  const mission = findMission(record.missionId);
  const r = RESULT[record.result];
  const back = () => {
    launchRuntime.reset();
    goTo('mission-control');
  };
  return (
    <div className="panel debrief" role="dialog" aria-label="Flight debrief">
      <div className={`status-banner tone-${r.tone}`}>{r.label}</div>
      <h2 className="debrief-title">{record.missionName}</h2>
      <p>{record.summary}</p>
      {record.crewSafe !== null && (
        <p className={record.crewSafe ? 'tone-ok' : 'tone-bad'}>
          {record.crewSafe ? '✓ Crew safe.' : '✕ Crew lost.'}
        </p>
      )}
      {record.recovery && <RecoveryResultLine r={record.recovery} />}
      {record.credited && mission && !mission.contract && (
        <p className="tone-ok">
          Mission credited: +{mission.rewardRp} RP and +{fmt(mission.rewardCredits)} cr on first
          completion.
        </p>
      )}
      {record.result !== 'scrubbed' && (
        <dl className="facts">
          <dt>Max altitude</dt>
          <dd>{fmt(record.maxAltitudeM / 1000, 1)} km</dd>
          <dt>Max speed</dt>
          <dd>{fmt(record.maxSpeedMS)} m/s</dd>
          <dt>Max-Q</dt>
          <dd>{fmt(record.maxQPa / 1000, 1)} kPa</dd>
          <dt>Flight time</dt>
          <dd>{fmt(record.durationS)} s</dd>
        </dl>
      )}
      {record.events.length > 0 && (
        <details className="section-gap">
          <summary>Flight log ({record.events.length} events)</summary>
          <ol className="event-log">
            {record.events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
        </details>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={back}>
          Back to Mission Control
        </button>
        {record.result === 'scrubbed' && (
          <button type="button" onClick={() => syncLaunchWithPlan()}>
            Recycle and try again
          </button>
        )}
      </div>
      <p className="footnote">
        {record.result === 'scrubbed'
          ? 'Scrubs cost nothing; the commitment stands.'
          : 'This attempt used the commitment. Plan and commit the next flight in Mission Control.'}
      </p>
    </div>
  );
}
