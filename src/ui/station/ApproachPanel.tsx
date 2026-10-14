import type { ProximityView } from '../../station/proximitySession';
import { closingLimitMS, CORRIDOR_HALF_ANGLE_DEG, DOCK_WINDOW, RCS } from '../../station/proximity';
import { formatPercent } from '../format';
import { fmt } from '../flight/useFlight';

function Check({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <li className={ok ? 'done' : 'current'}>
      <span className="check" aria-hidden="true">
        {ok ? '✓' : '○'}
      </span>
      <span>
        {label}: {value}
      </span>
    </li>
  );
}

/** Range, rates, alignment and the corridor rules, with the docking window as a checklist. */
export function ApproachPanel({ view }: { view: ProximityView }) {
  const m = view.metrics;
  const s = view.state;
  const docked = s.phase === 'docked';
  const toPort = Math.hypot(m.alongM, m.lateralM);
  const limit = closingLimitMS(toPort);
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Approach</h2>
        <span
          className={`badge ${docked ? 'tone-ok' : s.violating ? 'tone-bad' : m.inKeepOut ? 'tone-warn' : ''}`}
        >
          {docked
            ? 'DOCKED'
            : s.violating
              ? 'VIOLATION'
              : m.inKeepOut
                ? 'KEEP-OUT ZONE'
                : 'FREE FLIGHT'}
        </span>
      </div>
      <dl className="facts">
        <dt>Range to port</dt>
        <dd>{toPort >= 1_000 ? `${fmt(toPort / 1000, 2)} km` : `${fmt(toPort, 1)} m`}</dd>
        <dt>Closing speed</dt>
        <dd className={m.inKeepOut && m.closingMS > limit ? 'tone-bad' : undefined}>
          {fmt(m.closingMS, 2)} m/s{' '}
          {m.inKeepOut && <span className="muted">(limit {fmt(limit, 2)})</span>}
        </dd>
        <dt>Lateral offset · drift</dt>
        <dd>
          {fmt(m.lateralM, 2)} m · {fmt(m.lateralSpeedMS, 2)} m/s
        </dd>
        <dt>Offsets (up · left)</dt>
        <dd>
          {fmt(s.p[0], 1)} · {fmt(s.p[2], 1)} m
        </dd>
        <dt>Pointing · roll error</dt>
        <dd>
          {fmt(m.angleErrDeg, 1)}° · {fmt(m.rollErrDeg, 1)}°
        </dd>
        <dt>Corridor</dt>
        <dd className={m.inCorridor ? 'tone-ok' : m.inKeepOut ? 'tone-bad' : undefined}>
          {m.alongM > 0 ? `${fmt(m.corridorDeg, 1)}° off axis` : 'behind the port'} (≤{' '}
          {CORRIDOR_HALF_ANGLE_DEG}°)
        </dd>
        <dt>RCS Δv left</dt>
        <dd className={s.rcsLeftMS < 5 ? 'tone-warn' : undefined}>
          {fmt(s.rcsLeftMS, 1)} / {RCS.budgetMS} m/s
        </dd>
        <dt>Hull</dt>
        <dd className={s.hull < 1 ? 'tone-warn' : undefined}>{formatPercent(s.hull)}</dd>
        <dt>Violations · bounces · collisions</dt>
        <dd>
          {s.violations} · {s.bounces} · {s.collisions}
        </dd>
      </dl>
      {!docked && (
        <>
          <div className="eyebrow section-gap">Docking window at contact</div>
          <ul className="checklist">
            <Check
              ok={
                m.closingMS >= DOCK_WINDOW.minClosingMS && m.closingMS <= DOCK_WINDOW.maxClosingMS
              }
              label="Closing"
              value={`${DOCK_WINDOW.minClosingMS}–${DOCK_WINDOW.maxClosingMS} m/s`}
            />
            <Check
              ok={m.lateralM <= DOCK_WINDOW.offsetM}
              label="Offset"
              value={`≤ ${DOCK_WINDOW.offsetM} m`}
            />
            <Check
              ok={m.angleErrDeg <= DOCK_WINDOW.angleDeg}
              label="Pointing"
              value={`≤ ${DOCK_WINDOW.angleDeg}°`}
            />
            <Check
              ok={m.rollErrDeg <= DOCK_WINDOW.rollDeg}
              label="Roll"
              value={`≤ ${DOCK_WINDOW.rollDeg}°`}
            />
            <Check
              ok={m.lateralSpeedMS <= DOCK_WINDOW.lateralMS}
              label="Drift"
              value={`≤ ${DOCK_WINDOW.lateralMS} m/s`}
            />
          </ul>
        </>
      )}
      <p className="footnote">Clohessy–Wiltshire relative motion: drift is real. Game values.</p>
    </div>
  );
}
