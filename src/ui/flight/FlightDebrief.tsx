import { useGameStore } from '../../app/gameStore';
import { flightRuntime } from '../../app/flightBinding';
import type { FlightRecord } from '../../launch/flightRecord';
import { findMission } from '../../missions/missionCatalog';
import { RecoveryResultLine } from '../launch/RecoveryPanel';
import { formatPercent } from '../format';
import { fmt, formatDuration } from './useFlight';

const RESULT = {
  success: { label: '✓ MISSION SUCCESS', tone: 'ok' },
  partial: { label: '✓ SAFE RETURN', tone: 'ok' },
  failure: { label: '✕ MISSION FAILED', tone: 'bad' },
  aborted: { label: '! FLIGHT ENDED', tone: 'warn' },
  scrubbed: { label: '! SCRUBBED', tone: 'warn' },
} as const;

const OUTCOME = {
  landed: 'Landed',
  splashdown: 'Splashdown',
  crash: 'Crashed',
  breakup: 'Broke up in re-entry',
  stranded: 'Left in space',
} as const;

/** Post-flight debrief: outcome, landing accuracy, ship condition, rewards and next steps. */
export function FlightDebrief({ record }: { record: FlightRecord }) {
  const goTo = useGameStore((s) => s.goTo);
  const mission = findMission(record.missionId);
  const r = RESULT[record.result];
  const l = record.landing;
  const close = (target: 'mission-control' | 'factory') => {
    flightRuntime.reset();
    goTo(target);
  };
  return (
    <div className="panel debrief" role="dialog" aria-label="Flight debrief">
      <div className={`status-banner tone-${r.tone}`}>{r.label}</div>
      <h2 className="debrief-title">{record.missionName}</h2>
      <p>{record.summary}</p>
      {record.recovery && <RecoveryResultLine r={record.recovery} />}
      {record.contract && (
        <p className={record.contract.met ? 'tone-ok' : 'tone-bad'}>
          {record.contract.met ? '✓ Contract terms met: ' : '✕ Contract not met: '}
          {record.contract.detail} Payment is settled with the client in Mission Control.
        </p>
      )}
      {record.docking && (
        <p className={record.docking.grade ? 'tone-ok' : 'tone-warn'}>
          {record.docking.grade ? (
            <>
              ✓ Docked with the station, rating{' '}
              <strong className={`grade-${record.docking.grade}`}>{record.docking.grade}</strong>
              {record.docking.manual ? ' (flown manually)' : ' (assisted)'}
              {record.docking.tasksDone ? '; all station tasks done.' : '; tasks incomplete.'}
            </>
          ) : (
            '! No docking.'
          )}
          {record.docking.bounces + record.docking.collisions + record.docking.violations > 0 &&
            ` Bounces ${record.docking.bounces}, collisions ${record.docking.collisions}, corridor violations ${record.docking.violations}.`}
        </p>
      )}
      {record.lunar && (
        <p className={record.lunar.flyby || record.lunar.landing ? 'tone-ok' : 'tone-warn'}>
          {record.lunar.landing
            ? record.lunar.landing.outcome === 'landed'
              ? `✓ Landed on the Moon at ${record.lunar.landing.siteName}, rating ${record.lunar.landing.grade ?? '—'}${record.lunar.landing.manual ? ' (flown manually)' : ' (assisted)'}, ${Math.round(record.lunar.landing.missM)} m from the target${record.lunar.surfaceDone ? '; surface tasks done' : '; surface tasks incomplete'}${record.lunar.ascent ? '; back in lunar orbit.' : '.'}`
              : `✕ Lunar landing at ${record.lunar.landing.siteName} failed: the ship ${record.lunar.landing.outcome === 'tipped' ? 'tipped over' : 'crashed'}.`
            : record.lunar.flyby
              ? `✓ Lunar flyby: closest approach ${Math.round((record.lunar.closestAltM ?? 0) / 1000).toLocaleString('en-US')} km.`
              : '! The ship did not reach the Moon.'}
          {record.lunar.refuels > 0 && ` Refuelled ${record.lunar.refuels}×.`}
          {record.lunar.earthReturn ? ' Returned to Earth orbit.' : ''}
        </p>
      )}
      {record.crewSafe !== null && (
        <p className={record.crewSafe ? 'tone-ok' : 'tone-bad'}>
          {record.crewSafe ? '✓ Crew safe.' : '✕ Crew lost.'}
        </p>
      )}
      {record.credited && mission && !mission.contract && (
        <p className="tone-ok">
          Mission credited: +{mission.rewardRp} RP and +{fmt(mission.rewardCredits)} cr on first
          completion. New missions may now be available in Mission Control.
        </p>
      )}
      {l && (
        <dl className="facts">
          <dt>Outcome</dt>
          <dd>{OUTCOME[l.outcome]}</dd>
          {l.missM !== null && (
            <>
              <dt>Miss distance</dt>
              <dd>
                {fmt(Math.abs(l.missM) / 1000, 2)} km {l.missM >= 0 ? 'long' : 'short'}
              </dd>
            </>
          )}
          {l.grade && (
            <>
              <dt>Landing rating</dt>
              <dd>
                <strong className={`grade-${l.grade}`}>{l.grade}</strong>
                {l.manual ? ' · flown manually' : ' · autopilot'}
              </dd>
            </>
          )}
          <dt>Ship recovered</dt>
          <dd>{l.shipRecovered ? 'Yes (joins the fleet)' : 'No'}</dd>
          <dt>Orbits</dt>
          <dd>{l.orbits}</dd>
          <dt>Heat shield · hull</dt>
          <dd>
            {formatPercent(l.shield)} · {formatPercent(l.hull)}
          </dd>
          <dt>Peak heating · g</dt>
          <dd>
            {fmt(l.peakHeatKWm2)} kW/m² · {fmt(l.peakG, 1)} g
          </dd>
          <dt>Max altitude</dt>
          <dd>{fmt(record.maxAltitudeM / 1000, 1)} km</dd>
          <dt>Mission time</dt>
          <dd>{formatDuration(record.durationS)}</dd>
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
        <button type="button" className="primary" onClick={() => close('mission-control')}>
          Back to Mission Control
        </button>
        <button type="button" onClick={() => close('factory')}>
          Go to the Factory
        </button>
      </div>
      <p className="footnote">
        This flight used the mission commitment. Plan the next one in Mission Control.
      </p>
    </div>
  );
}
