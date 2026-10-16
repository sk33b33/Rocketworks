import { flightRuntime } from '../../app/flightBinding';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { NODE_LIMITS, nodeTimes, type ManeuverNode } from '../../flight/maneuver';
import { orbitalElements } from '../../flight/orbitMath';
import { fmt, formatDuration } from './useFlight';

const STEPS = [-10, -1, 1, 10] as const;

/** A Δv component: a slider for big moves, buttons for fine ones. */
function DvControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const max = NODE_LIMITS.maxComponentMS;
  return (
    <div className="node-row">
      <label>
        <span>
          {label} <strong>{fmt(value, 1)} m/s</strong>
        </span>
        <input
          type="range"
          min={-max / 3}
          max={max / 3}
          step={1}
          value={Math.max(-max / 3, Math.min(max / 3, value))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <div className="node-steps" role="group" aria-label={`${label} fine adjust`}>
        {STEPS.map((d) => (
          <button key={d} type="button" onClick={() => onChange(value + d)}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Manoeuvre planner (Earth orbit): place a node, shape the burn with prograde and radial Δv and
 * its time, see the orbit it gives (also dashed on the map), then let the autopilot fly it.
 */
export function ManeuverPanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  const node = snap.node;
  const plan = snap.nodePlan;
  const can = flightRuntime.nodeAvailability();
  const flying = snap.program.program === 'execute-node';
  if (!s) return null;
  const set = (n: ManeuverNode | null) => flightRuntime.setNode(n);
  const times = nodeTimes(s.r, s.v, s.tS);
  const el = orbitalElements(s.r, s.v);

  if (!node) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Manoeuvre planner</h2>
        </div>
        {can.ok ? (
          <>
            <p className="small-text">
              Plan a burn: pick when, then shape it. The map (M) shows the orbit it gives as a
              dashed line.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={times.apoS === null}
                title={times.apoS === null ? 'The orbit is circular: no apoapsis to aim for.' : ''}
                onClick={() =>
                  times.apoS !== null && set({ tS: times.apoS, progradeMS: 0, radialMS: 0 })
                }
              >
                At apoapsis
              </button>
              <button
                type="button"
                disabled={times.periS === null}
                title={
                  times.periS === null ? 'The orbit is circular: no periapsis to aim for.' : ''
                }
                onClick={() =>
                  times.periS !== null && set({ tS: times.periS, progradeMS: 0, radialMS: 0 })
                }
              >
                At periapsis
              </button>
              <button
                type="button"
                onClick={() => set({ tS: s.tS + 600, progradeMS: 0, radialMS: 0 })}
              >
                In 10 min
              </button>
            </div>
          </>
        ) : (
          <p className="small-text muted">{can.reason}</p>
        )}
      </div>
    );
  }

  const exec = flightRuntime.executeNodeAvailability();
  const move = (patch: Partial<ManeuverNode>) => set({ ...node, ...patch });
  const inS = node.tS - s.tS;
  const burning = flying && snap.program.burning;
  const after = plan?.elements;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Manoeuvre node</h2>
      </div>
      <dl className="facts">
        <dt>Burn</dt>
        <dd>{inS > 0 ? `in ${formatDuration(inS)}` : 'now'}</dd>
        <dt>Δv</dt>
        <dd>{plan ? `${fmt(plan.dvMS, 1)} m/s` : '—'}</dd>
        <dt>Orbit now</dt>
        <dd>
          {fmt(el.apoapsisAltM / 1000)} × {fmt(el.periapsisAltM / 1000)} km
        </dd>
        <dt>After</dt>
        <dd className={after && after.status !== 'orbit' ? 'tone-warn' : undefined}>
          {after
            ? after.status === 'escape'
              ? 'Escape trajectory'
              : `${fmt(after.apoapsisAltM / 1000)} × ${fmt(after.periapsisAltM / 1000)} km${after.status === 'suborbital' ? ' (re-enters)' : ''}`
            : burning
              ? 'Burning…'
              : '—'}
        </dd>
      </dl>
      {!burning && (
        <>
          <DvControl
            label="Prograde"
            value={node.progradeMS}
            onChange={(v) => move({ progradeMS: v })}
          />
          <DvControl
            label="Radial out"
            value={node.radialMS}
            onChange={(v) => move({ radialMS: v })}
          />
          <div className="node-steps" role="group" aria-label="Node time">
            <button type="button" onClick={() => move({ tS: node.tS - 60 })}>
              −1 min
            </button>
            <button type="button" onClick={() => move({ tS: node.tS + 60 })}>
              +1 min
            </button>
            <button
              type="button"
              disabled={times.apoS === null}
              onClick={() => times.apoS !== null && move({ tS: times.apoS })}
            >
              Apoapsis
            </button>
            <button
              type="button"
              disabled={times.periS === null}
              onClick={() => times.periS !== null && move({ tS: times.periS })}
            >
              Periapsis
            </button>
          </div>
        </>
      )}
      <div className="actions section-gap">
        {flying ? (
          <button type="button" onClick={() => flightRuntime.engage('none')}>
            Stop the burn program
          </button>
        ) : (
          <button
            type="button"
            className={exec.ok ? 'primary' : undefined}
            disabled={!exec.ok}
            title={exec.ok ? 'The autopilot turns the ship and flies the burn' : exec.reason}
            onClick={() => flightRuntime.engage('execute-node')}
          >
            Execute node
          </button>
        )}
        <button type="button" disabled={burning} onClick={() => set(null)}>
          Delete node
        </button>
      </div>
      {!exec.ok && !flying && <p className="small-text muted">{exec.reason}</p>}
      {flying && !burning && (
        <p className="small-text">Waiting for the burn: the ship turns to the node's direction.</p>
      )}
    </div>
  );
}
