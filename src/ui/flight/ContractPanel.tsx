import { flightRuntime } from '../../app/flightBinding';
import { separationOffset, type FlightSnapshot } from '../../flight/flightRuntime';
import { orbitalElements } from '../../flight/orbitMath';
import { CONTRACT_KIND_LABELS } from '../../economy/contracts';
import { formatCredits } from '../format';
import { fmt } from './useFlight';

const HINTS = {
  resupply: 'Rendezvous and dock with the station; the docked tasks unload the module.',
  'crew-rotation': 'Rendezvous and dock with the station; the docked tasks hand over the crew.',
  'lunar-depot': 'Fly to lunar orbit and dock at the depot ("Unload at the depot") to deliver.',
  'mars-tanker': 'Land within 2 km of the plant at the Mars location; the ship unloads itself.',
} as const;

/** The client's terms for a contract flight, and (satellites) the release. */
export function ContractPanel({ snap }: { snap: FlightSnapshot }) {
  const c = snap.context?.contract;
  const s = flightRuntime.liveState ?? snap.state;
  if (!c || !s) return null;
  const release = snap.progress.release;
  const el =
    s.phase === 'flight' && !s.origin && s.ref !== 'moon' ? orbitalElements(s.r, s.v) : null;
  const avail = c.kind === 'satellite' ? flightRuntime.releaseAvailability() : null;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Contract</h2>
        <span className={`badge ${release?.ok ? 'tone-ok' : ''}`}>
          {release?.ok ? 'DELIVERED' : CONTRACT_KIND_LABELS[c.kind].toUpperCase()}
        </span>
      </div>
      <p className="small-text">
        {c.title} <span className="muted">· {c.client}</span>
      </p>
      {c.kind === 'satellite' && c.targetAltKm !== null ? (
        <>
          <dl className="facts">
            <dt>Requested orbit</dt>
            <dd>
              {c.targetAltKm} ± {c.toleranceKm} km
            </dd>
            {el && el.status === 'orbit' && (
              <>
                <dt>Orbit now</dt>
                <dd className={avail?.ok ? 'tone-ok' : undefined}>
                  {fmt(el.apoapsisAltM / 1000)} × {fmt(el.periapsisAltM / 1000)} km
                </dd>
              </>
            )}
            <dt>Satellite</dt>
            <dd>
              {fmt(c.payloadKg / 1000)} t{' '}
              {release ? `released at ${fmt(release.apoKm)} × ${fmt(release.periKm)} km` : 'aboard'}
            </dd>
          </dl>
          {!release && (
            <>
              <div className="actions">
                <button
                  type="button"
                  className={avail?.ok ? 'primary' : undefined}
                  disabled={!avail?.ok}
                  title={avail?.ok ? undefined : avail?.reason}
                  onClick={() => flightRuntime.releasePayload()}
                >
                  Release the satellite
                </button>
              </div>
              <p className="small-text muted">
                {avail?.ok
                  ? 'In the requested orbit: release it now.'
                  : `${avail?.reason ?? ''} "Raise orbit" in the autopilot climbs there.`}
              </p>
            </>
          )}
          {release?.r && release.tS !== undefined && (
            <p className="small-text muted">
              The satellite is {satelliteRange(release.r, release.tS, s.tS)} from the ship and
              drifting clear.
            </p>
          )}
          {release && (
            <p className="small-text tone-ok">
              Delivered. Bring the ship home to keep it in the fleet.
            </p>
          )}
        </>
      ) : (
        <p className="small-text muted">{c.kind !== 'satellite' && HINTS[c.kind]}</p>
      )}
      <p className="small-text muted">
        Pays {formatCredits(c.payout)} if the terms are met before the deadline.
      </p>
    </div>
  );
}

function satelliteRange(r: readonly [number, number], releasedT: number, t: number): string {
  const { up, along } = separationOffset(Math.max(0, t - releasedT), Math.hypot(r[0], r[1]));
  const m = Math.hypot(up, along);
  return m >= 10_000
    ? `${fmt(m / 1000)} km`
    : m >= 1_000
      ? `${fmt(m / 1000, 1)} km`
      : `${fmt(m)} m`;
}
