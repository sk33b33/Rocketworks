import { launchRuntime } from '../../app/launchBinding';
import type { LaunchSnapshot } from '../../launch/launchRuntime';
import { G0_MS2 } from '../../simulation/constants';
import { formatPercent } from '../format';

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** SVG altitude-vs-downrange profile of the ascent so far. */
function ProfileChart({ snap }: { snap: LaunchSnapshot }) {
  const s = snap.ascent;
  const pts = s ? [...snap.profile, { x: s.downrangeM, h: s.altitudeM }] : snap.profile;
  const target = snap.context?.config.target;
  const targetAlt = target?.kind === 'orbit' ? target.altitudeM : 100_000;
  const maxX = Math.max(100_000, ...pts.map((p) => p.x)) * 1.05;
  const maxH = Math.max(targetAlt * 1.2, ...pts.map((p) => p.h)) * 1.05;
  const W = 280;
  const H = 110;
  const px = (x: number) => (x / maxX) * W;
  const py = (h: number) => H - (h / maxH) * H;
  return (
    <svg
      className="profile"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Ascent profile: altitude ${fmt((s?.altitudeM ?? 0) / 1000, 1)} km at ${fmt((s?.downrangeM ?? 0) / 1000)} km downrange`}
    >
      <line x1="0" x2={W} y1={py(targetAlt)} y2={py(targetAlt)} className="profile-target" />
      <text x="4" y={py(targetAlt) - 3} className="profile-label">
        {target?.kind === 'orbit' ? `target ${fmt(targetAlt / 1000)} km` : '100 km'}
      </text>
      <polyline
        points={pts.map((p) => `${px(p.x)},${py(p.h)}`).join(' ')}
        className="profile-line"
      />
      {s && <circle cx={px(s.downrangeM)} cy={py(s.altitudeM)} r="3" className="profile-dot" />}
    </svg>
  );
}

/** Live flight telemetry, profile chart and event log. */
export function TelemetryPanel({ snap }: { snap: LaunchSnapshot }) {
  const s = snap.ascent ?? launchRuntime.liveAscent;
  const v = snap.context?.config.vehicle;
  if (!s || !v) return null;
  const speed = Math.hypot(s.vHorizMS, s.vVertMS);
  const boosterRunning = Math.max(0, v.booster.engineCount - s.boosterEnginesOut);
  const shipRunning = Math.max(0, v.ship.engineCount - s.shipEnginesOut);
  return (
    <div className="panel telemetry">
      <div className="panel-header">
        <h2>Telemetry</h2>
        <span className="muted">T+{fmt(s.tS)} s</span>
      </div>
      <dl className="facts">
        <dt>Altitude</dt>
        <dd>{fmt(s.altitudeM / 1000, 1)} km</dd>
        <dt>Speed</dt>
        <dd>{fmt(speed)} m/s</dd>
        <dt>Horizontal / vertical</dt>
        <dd>
          {fmt(s.vHorizMS)} / {fmt(s.vVertMS)} m/s
        </dd>
        <dt>Downrange</dt>
        <dd>{fmt(s.downrangeM / 1000, 1)} km</dd>
        <dt>Acceleration</dt>
        <dd>{fmt(s.accelerationG, 2)} g</dd>
        <dt>Dynamic pressure</dt>
        <dd>
          {fmt(s.dynamicPressurePa / 1000, 1)} kPa{' '}
          <span className="muted">(max {fmt(s.maxQPa / 1000, 1)})</span>
        </dd>
        <dt>Stage</dt>
        <dd>
          {s.stage === 'booster'
            ? `Booster · ${boosterRunning}/${v.booster.engineCount} engines`
            : `Ship · ${shipRunning}/${v.ship.engineCount} engines`}
        </dd>
        <dt>Throttle · pitch</dt>
        <dd>
          {formatPercent(s.throttle)} · {fmt(s.elevationDeg)}° above horizon
        </dd>
        <dt>Booster propellant</dt>
        <dd>
          {formatPercent(v.booster.propellantKg ? s.boosterPropKg / v.booster.propellantKg : 0)}
        </dd>
        <dt>Ship propellant</dt>
        <dd>{formatPercent(v.ship.propellantKg ? s.shipPropKg / v.ship.propellantKg : 0)}</dd>
      </dl>
      <ProfileChart snap={snap} />
      <ol className="event-log" aria-live="polite">
        {[...s.events]
          .reverse()
          .slice(0, 8)
          .map((e, i) => (
            <li key={`${e.tS}-${i}`} className={`ev-${e.kind}`}>
              <span className="muted">T+{fmt(e.tS)}s</span> {e.text}
            </li>
          ))}
      </ol>
      <p className="footnote">
        Simplified 2D ascent model; {fmt(G0_MS2, 2)} m/s² standard gravity. Game values, not flight
        data.
      </p>
    </div>
  );
}
