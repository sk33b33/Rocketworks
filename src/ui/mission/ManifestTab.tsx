import { selectMissionReport, useGameStore } from '../../app/gameStore';
import { CREW_ROSTER, ROLE_LABELS, STATUS_LABELS } from '../../missions/crew';
import { findPayload } from '../../missions/missionCatalog';
import { certificationStatus } from '../../rocket/readiness/certification';
import { calculateRocketStats } from '../../rocket/stats/calculateRocketStats';
import { formatMass } from '../format';
import { RecoveryFleetSection } from './RecoveryFleetSection';

const CERT_TEXT = {
  none: 'not certified',
  valid: '✓ certified',
  override: '! override',
  expired: 'certification expired',
} as const;

/** Vehicle, payload and crew assignment. */
export function ManifestTab() {
  const setup = useGameStore((s) => s.mission);
  const blueprints = useGameStore((s) => s.blueprints);
  const report = useGameStore(selectMissionReport);
  const actions = useGameStore.getState();
  const req = report.mission.requirements;
  const crewed = req.maxCrew > 0;
  const bp = blueprints.find((b) => b.id === setup.designId);
  const seats = bp ? calculateRocketStats(bp).crewCapacity : 0;

  return (
    <div className="manifest">
      <fieldset className="stacked">
        <legend className="eyebrow">Vehicle</legend>
        {blueprints.map((b) => {
          const cert = certificationStatus(b);
          return (
            <label key={b.id}>
              <input
                type="radio"
                name="design"
                checked={setup.designId === b.id}
                onChange={() => actions.setMissionDesign(b.id)}
              />
              <span>
                {b.name}{' '}
                <span
                  className={
                    cert === 'valid' ? 'tone-ok' : cert === 'override' ? 'tone-warn' : 'muted'
                  }
                >
                  ({CERT_TEXT[cert]}, {b.role})
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <RecoveryFleetSection bp={bp} />

      <fieldset className="stacked">
        <legend className="eyebrow">Payload</legend>
        {report.mission.payloadIds.map((id) => {
          const p = findPayload(id)!;
          return (
            <label key={id} title={p.description}>
              <input
                type="radio"
                name="payload"
                checked={setup.payloadId === id}
                onChange={() => actions.setMissionPayload(id)}
              />
              <span>
                {p.name}{' '}
                <span className="muted">
                  · {formatMass(p.massKg)}
                  {p.requiresBay ? ' · needs cargo bay' : ''}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="row">
        <span className="eyebrow">Crew</span>
        <span className="muted">
          {crewed
            ? `${setup.crewIds.length} assigned · ${req.minCrew}–${req.maxCrew} allowed · ${seats} seats`
            : 'Uncrewed mission'}
        </span>
      </div>
      <ul className="crew-list">
        {CREW_ROSTER.map((c) => {
          const assigned = setup.crewIds.includes(c.id);
          const reason = assigned
            ? undefined
            : !crewed
              ? 'This mission is uncrewed.'
              : c.status === 'medical-hold'
                ? `${c.name} is on medical hold.`
                : setup.crewIds.length >= req.maxCrew
                  ? `This mission carries at most ${req.maxCrew} crew.`
                  : undefined;
          return (
            <li key={c.id} className={assigned ? 'assigned' : ''}>
              <div className="crew-head">
                <strong>{c.name}</strong>
                <span className={`crew-status status-${c.status}`}>{STATUS_LABELS[c.status]}</span>
              </div>
              <div className="muted">
                {ROLE_LABELS[c.role]} · skill{' '}
                <span aria-hidden="true">
                  {'★'.repeat(c.skill)}
                  {'☆'.repeat(5 - c.skill)}
                </span>
                <span className="sr-only">{c.skill} of 5</span>
              </div>
              <p className="crew-bio">{c.statusNote ?? c.bio}</p>
              <button
                type="button"
                className={assigned ? 'danger' : ''}
                onClick={() => actions.toggleCrew(c.id)}
                disabled={!!reason}
                title={reason}
                aria-pressed={assigned}
              >
                {assigned ? 'Remove' : 'Assign'}
              </button>
            </li>
          );
        })}
      </ul>
      <dl className="facts">
        <dt>Carried mass (payload + crew)</dt>
        <dd>{formatMass(report.carriedMassKg)}</dd>
        <dt>Life support</dt>
        <dd>
          {Math.round(report.lifeSupport.requiredCrewDays)} / {report.lifeSupport.capacityCrewDays}{' '}
          crew-days
        </dd>
      </dl>
    </div>
  );
}
