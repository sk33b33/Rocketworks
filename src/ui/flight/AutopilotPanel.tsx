import { flightRuntime } from '../../app/flightBinding';
import type { AttitudeMode, ProgramId } from '../../flight/autopilot';
import {
  PROGRAM_LABELS,
  programAvailability,
  type FlightSnapshot,
} from '../../flight/flightRuntime';
import { LANDING_ZONES, missDistanceM, type LandingZone } from '../../flight/landingZones';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { localFrame } from '../../flight/orbitMath';
import { fmt } from './useFlight';

const MODES: { id: AttitudeMode; label: string }[] = [
  { id: 'prograde', label: 'Prograde' },
  { id: 'retrograde', label: 'Retrograde' },
  { id: 'radial-out', label: 'Radial out' },
  { id: 'radial-in', label: 'Radial in' },
  { id: 'belly', label: 'Belly-first' },
  { id: 'manual', label: 'Manual' },
];

const PROGRAMS: ProgramId[] = ['circularize', 'deorbit', 'reentry', 'landing'];

/** Landing zone, guidance programs and attitude holds. Unavailable programs say why. */
export function AutopilotPanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  if (!s) return null;
  const flying = s.phase === 'flight';
  const active = flying ? snap.program.program : 'none';
  const angle = localFrame(s.r).groundAngle;
  // Distance ahead along the ground track (0..40,000 km eastward).
  const ahead = (z: LandingZone) => {
    const d = -missDistanceM(angle, z);
    return d < 0 ? d + 2 * Math.PI * EARTH_RADIUS_M : d;
  };
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Autopilot</h2>
        <span className={`badge ${active === 'none' ? '' : 'tone-ok'}`}>
          {active === 'none' ? 'OFF' : 'ACTIVE'}
        </span>
      </div>
      <fieldset className="zone-picker" disabled={!flying}>
        <legend className="eyebrow">Landing zone</legend>
        {LANDING_ZONES.map((z) => (
          <label key={z.id} className="zone-option" title={z.description}>
            <input
              type="radio"
              name="zone"
              checked={snap.zone.id === z.id}
              onChange={() => flightRuntime.setZone(z.id)}
            />
            <span>
              {z.name}
              <span className="muted small-text">
                {' '}
                · ±{fmt(z.toleranceM / 1000, z.toleranceM < 10_000 ? 1 : 0)} km ·{' '}
                {fmt(ahead(z) / 1000)} km ahead
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="eyebrow section-gap">Programs</div>
      <div className="program-list">
        {PROGRAMS.map((id) => {
          const check = programAvailability(id, s, snap.progress);
          const on = active === id;
          return (
            <div key={id} className="program-row">
              <button
                type="button"
                className={on ? 'primary' : undefined}
                aria-pressed={on}
                disabled={!on && !check.ok}
                title={check.ok ? undefined : check.reason}
                onClick={() => flightRuntime.engage(on ? 'none' : id)}
              >
                {PROGRAM_LABELS[id]}
              </button>
              {!on && !check.ok && <span className="small-text muted">{check.reason}</span>}
              {on && <span className="small-text tone-ok">{programStatus(snap)}</span>}
            </div>
          );
        })}
      </div>
      <div className="eyebrow section-gap">Attitude hold</div>
      <div className="mode-grid" role="group" aria-label="Attitude hold">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={active === 'none' && snap.mode === m.id}
            disabled={!flying}
            onClick={() => flightRuntime.setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {active !== 'none' && (
        <p className="small-text muted">
          Selecting an attitude hold or using W/S/Q/E or the throttle keys hands control back to
          you.
        </p>
      )}
    </div>
  );
}

function programStatus(snap: FlightSnapshot): string {
  const p = snap.program;
  switch (p.program) {
    case 'circularize':
      return p.burning ? 'Burning prograde…' : 'Coasting to apoapsis…';
    case 'deorbit':
      return p.burning
        ? 'Deorbit burn…'
        : p.deorbitBurnAngle === null
          ? 'Planning…'
          : 'Waiting for the burn point…';
    case 'reentry':
      return `Holding belly-first · bank ${fmt(p.bankDeg ?? 45)}°`;
    case 'landing':
      return p.burning ? 'Landing burn…' : p.flipped ? 'Flipping upright…' : 'Belly-flop descent…';
    default:
      return '';
  }
}
