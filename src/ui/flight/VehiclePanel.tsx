import { flightRuntime } from '../../app/flightBinding';
import { deltaVRemaining, FLIGHT } from '../../flight/flightModel';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { formatPercent } from '../format';
import { fmt } from './useFlight';

function Meter({
  label,
  value,
  warnBelow = 0.25,
}: {
  label: string;
  value: number;
  warnBelow?: number;
}) {
  const tone = value <= 0 ? 'bad' : value < warnBelow ? 'warn' : 'ok';
  return (
    <div className="meter-row">
      <span>{label}</span>
      <div
        className="progress"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div
          className={`progress-fill fill-${tone}`}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
      <span className={`tone-${tone}`}>{formatPercent(value)}</span>
    </div>
  );
}

/** Ship condition, propellant, heating, g-load and crew. */
export function VehiclePanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  const ctx = snap.context;
  if (!s || !ctx) return null;
  const stage = ctx.spec.stage;
  const running = Math.max(0, stage.engineCount - s.enginesOut);
  const heat = s.heatFluxWm2 / 1000;
  const highG = s.gLoad >= FLIGHT.crewGWarning;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Ship</h2>
        <span className="muted">{ctx.outcome.designName}</span>
      </div>
      <Meter
        label="Propellant"
        value={stage.propellantKg ? s.propKg / stage.propellantKg : 0}
        warnBelow={0.15}
      />
      <Meter label="Heat shield" value={s.shield} />
      <Meter label="Hull" value={s.hull} warnBelow={0.6} />
      <dl className="facts section-gap">
        <dt>Δv remaining</dt>
        <dd>{fmt(deltaVRemaining(ctx.spec, s.propKg))} m/s</dd>
        <dt>Engines · throttle</dt>
        <dd>
          {running}/{stage.engineCount} · {formatPercent(s.throttle)}
        </dd>
        <dt>Pitch · bank</dt>
        <dd>
          {fmt(s.pitchDeg)}° · {fmt(s.bankDeg)}°
        </dd>
        <dt>Angle of attack</dt>
        <dd>{fmt(s.angleOfAttackDeg)}°</dd>
        <dt>Heating</dt>
        <dd className={heat > 300 ? 'tone-warn' : undefined}>
          {fmt(heat)} kW/m² <span className="muted">(peak {fmt(s.peakHeatFluxWm2 / 1000)})</span>
        </dd>
        <dt>Acceleration</dt>
        <dd className={highG ? 'tone-bad' : undefined}>
          {fmt(s.gLoad, 2)} g <span className="muted">(peak {fmt(s.peakG, 1)})</span>
        </dd>
        <dt>Heat-shield coverage</dt>
        <dd className={ctx.spec.shieldCoverage < 1 ? 'tone-warn' : undefined}>
          {formatPercent(ctx.spec.shieldCoverage)}
        </dd>
        <dt>Flaps</dt>
        <dd className={ctx.spec.hasFlaps ? undefined : 'tone-warn'}>
          {ctx.spec.hasFlaps ? 'Fitted' : 'Missing: cannot hold belly-first'}
        </dd>
        <dt>Crew</dt>
        <dd>
          {ctx.crewed ? `${ctx.crewNames.length} aboard${highG ? ' · HIGH G' : ''}` : 'Uncrewed'}
        </dd>
      </dl>
      {ctx.crewed && ctx.crewNames.length > 0 && (
        <p className="small-text muted">{ctx.crewNames.join(', ')}</p>
      )}
    </div>
  );
}
