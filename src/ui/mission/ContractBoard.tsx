import { useGameStore } from '../../app/gameStore';
import { currentEconomy } from '../../app/store/economy';
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_MISSION,
  contractKindsAvailable,
  type Contract,
} from '../../economy/contracts';
import { PERIOD_DAYS, periodOf } from '../../economy/treasury';
import { findPayload } from '../../missions/missionCatalog';
import { programDay } from '../../progression/research';
import { formatCredits } from '../format';

const RESULT_LABELS = {
  paid: 'Paid',
  failed: 'Failed',
  late: 'Late',
  expired: 'Expired',
  cancelled: 'Cancelled',
} as const;

function terms(c: Contract): string {
  const payload = findPayload(c.payloadId);
  const mass = payload ? ` · ${Math.round(payload.massKg / 1000)} t` : '';
  return `${CONTRACT_KIND_LABELS[c.kind]}${mass}${c.targetAltKm ? ` · ${c.targetAltKm} ± ${c.toleranceKm} km` : ''}`;
}

/** Contract offers, the contract being flown, and the treasury and reputation they move. */
export function ContractBoard() {
  const progression = useGameStore((s) => s.progression);
  const missionId = useGameStore((s) => s.mission.missionId);
  const accept = useGameStore((s) => s.acceptContract);
  const cancel = useGameStore((s) => s.cancelContract);
  const plan = useGameStore((s) => s.planActiveContract);
  const e = currentEconomy(progression);
  const day = programDay(progression);
  const unlocked = contractKindsAvailable({
    completedMissionIds: progression.completedMissions,
    hasMarsBase: !!progression.marsBase,
  }).length;
  const active = e.active;
  const nextBoardDay = (periodOf(day) + 1) * PERIOD_DAYS;
  return (
    <div className="contract-board">
      <dl className="facts">
        <dt>Treasury</dt>
        <dd>{formatCredits(e.treasury)}</dd>
        <dt>Reputation</dt>
        <dd>{e.reputation} / 100</dd>
        <dt>Program day</dt>
        <dd>{day.toLocaleString('en-US')}</dd>
      </dl>
      {active && (
        <div className="contract-card active" aria-label="Active contract">
          <div className="eyebrow">Active contract</div>
          <strong>{active.title}</strong>
          <span className="muted small-text">
            {active.client} · {terms(active)}
          </span>
          <span className="small-text">
            Pays {formatCredits(active.payout)} · due day{' '}
            {active.deadlineDay.toLocaleString('en-US')} ({Math.max(0, active.deadlineDay - day)}{' '}
            days left)
          </span>
          <div className="actions">
            {missionId !== CONTRACT_MISSION[active.kind] && (
              <button type="button" className="primary" onClick={plan}>
                Plan this flight
              </button>
            )}
            <button type="button" onClick={cancel}>
              Cancel contract
            </button>
          </div>
        </div>
      )}
      {!unlocked ? (
        <p className="small-text muted">
          Clients start calling once the program has flown the Crewed Orbital Shakedown: satellite
          deployments first, then station, lunar and Mars cargo runs as those missions are flown.
        </p>
      ) : (
        <ul className="mission-list" aria-label="Contract offers">
          {e.board.offers.map((c) => {
            const repLocked = e.reputation < c.minReputation;
            const reason = active
              ? 'One contract at a time: finish or cancel the active one.'
              : repLocked
                ? `Needs reputation ${c.minReputation}.`
                : undefined;
            return (
              <li key={c.id} className="contract-card">
                <strong>{c.title}</strong>
                <span className="muted small-text">
                  {c.client} · {terms(c)}
                </span>
                <span className="small-text">
                  Pays <strong>{formatCredits(c.payout)}</strong> · {c.deadlineDays} days to deliver
                  · reputation +{c.repReward} / −{c.repPenalty}
                  {c.minReputation ? ` · premium client (rep ${c.minReputation}+)` : ''}
                </span>
                <div className="actions">
                  <button
                    type="button"
                    disabled={!!reason}
                    title={reason}
                    onClick={() => accept(c.id)}
                  >
                    Accept
                  </button>
                  {reason && <span className="small-text muted">{reason}</span>}
                </div>
              </li>
            );
          })}
          {e.board.offers.length === 0 && (
            <li className="small-text muted">No offers left this month.</li>
          )}
        </ul>
      )}
      <p className="footnote">
        New offers every {PERIOD_DAYS} days (next on day {nextBoardDay.toLocaleString('en-US')}).
        Flights are paid from the treasury when they fly; contracts pay when the client's terms are
        met before the deadline. Late or failed contracts pay nothing and cost reputation.
      </p>
      {e.history.length > 0 && (
        <>
          <div className="eyebrow section-gap">Recent contracts</div>
          <ul className="contract-history small-text">
            {[...e.history]
              .reverse()
              .slice(0, 4)
              .map((h) => (
                <li key={`${h.id}-${h.day}`}>
                  <span className={h.result === 'paid' ? 'tone-ok' : 'tone-bad'}>
                    {RESULT_LABELS[h.result]}
                  </span>{' '}
                  {h.title} ({h.client}){h.payout ? ` · +${formatCredits(h.payout)}` : ''}
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
