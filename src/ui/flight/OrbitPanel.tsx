import { flightRuntime } from '../../app/flightBinding';
import { LANDING_ZONES } from '../../flight/landingZones';
import {
  localFrame,
  orbitalElements,
  orbitPath,
  STABLE_PERIAPSIS_M,
  timeToApsides,
  type OrbitalElements,
} from '../../flight/orbitMath';
import type { FlightSnapshot } from '../../flight/flightRuntime';
import { EARTH_RADIUS_M } from '../../simulation/constants';
import { STATION_RADIUS_M, stationAngle } from '../../station/stationOrbit';
import { fmt, formatDuration } from './useFlight';

const STATUS = {
  orbit: { label: 'STABLE ORBIT', tone: 'ok' },
  suborbital: { label: 'SUBORBITAL', tone: 'warn' },
  escape: { label: 'ESCAPE TRAJECTORY', tone: 'bad' },
} as const;

/** 2D orbit inset: Earth, atmosphere line, path, ship and landing zones (schematic, not to scale). */
function OrbitInset({ snap, el }: { snap: FlightSnapshot; el: OrbitalElements }) {
  const s = snap.state!;
  const f = localFrame(s.r);
  const S = 180;
  const c = S / 2;
  // Exaggerate altitude so low orbits are visible: radius = earth + alt * k.
  const earthR = 52;
  const k = 0.00012;
  const pt = (angle: number, radiusM: number) => {
    const rr = earthR + Math.min(36, Math.max(0, radiusM - EARTH_RADIUS_M) * k);
    return [c + Math.sin(angle) * rr, c - Math.cos(angle) * rr] as const;
  };
  const path = s.phase === 'flight' ? orbitPath(el, f.groundAngle, 120) : [];
  const [sx, sy] = pt(f.groundAngle, EARTH_RADIUS_M + f.altitudeM);
  return (
    <svg
      className="orbit-inset"
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label={`Orbit diagram: ${STATUS[el.status].label.toLowerCase()}, altitude ${fmt(f.altitudeM / 1000)} km`}
    >
      <circle cx={c} cy={c} r={earthR + 100_000 * k} className="inset-atmo" />
      <circle cx={c} cy={c} r={earthR} className="inset-earth" />
      {LANDING_ZONES.map((z) => {
        const [x, y] = pt(z.groundAngle, EARTH_RADIUS_M);
        return (
          <circle
            key={z.id}
            cx={x}
            cy={y}
            r={z.id === snap.zone.id ? 4 : 2.5}
            className={`inset-zone inset-${z.kind} ${z.id === snap.zone.id ? 'selected' : ''}`}
          />
        );
      })}
      {path.length > 1 && (
        <polyline
          points={path.map((p) => pt(p.angle, p.radiusM).join(',')).join(' ')}
          className={`inset-path inset-${el.status}`}
        />
      )}
      {snap.station &&
        (() => {
          const [x, y] = pt(stationAngle(snap.station.eph, s.tS), STATION_RADIUS_M);
          return <rect x={x - 3} y={y - 3} width="6" height="6" className="inset-station" />;
        })()}
      <circle cx={sx} cy={sy} r="3.5" className="inset-ship" />
    </svg>
  );
}

/** Altitude and speed (where the ship is) kept separate from orbital state (where it's going). */
export function OrbitPanel({ snap }: { snap: FlightSnapshot }) {
  const s = flightRuntime.liveState ?? snap.state;
  if (!s) return null;
  const f = localFrame(s.r);
  const alt = Math.max(0, f.altitudeM);
  const el = orbitalElements(s.r, s.v);
  const t = timeToApsides(s.r, s.v, el);
  const st = STATUS[el.status];
  const down = s.phase !== 'flight';
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Orbit</h2>
        {!down && <span className={`badge tone-${st.tone}`}>{st.label}</span>}
      </div>
      <div className="eyebrow">Position</div>
      <dl className="facts">
        <dt>Altitude</dt>
        <dd>{alt >= 10_000 ? `${fmt(alt / 1000, 1)} km` : `${fmt(alt)} m`}</dd>
        <dt>Speed</dt>
        <dd>{fmt(el.speedMS)} m/s</dd>
        <dt>Horizontal / vertical</dt>
        <dd>
          {fmt(el.horizontalSpeedMS)} / {fmt(el.verticalSpeedMS)} m/s
        </dd>
      </dl>
      {!down && (
        <>
          <div className="eyebrow section-gap">Trajectory</div>
          <dl className="facts">
            <dt>Apoapsis</dt>
            <dd>
              {fmt(el.apoapsisAltM / 1000, 1)} km{' '}
              {el.status !== 'escape' && (
                <span className="muted">in {formatDuration(t.toApoS)}</span>
              )}
            </dd>
            <dt>Periapsis</dt>
            <dd className={el.periapsisAltM < STABLE_PERIAPSIS_M ? 'tone-warn' : undefined}>
              {fmt(el.periapsisAltM / 1000, 1)} km{' '}
              {el.status !== 'escape' && el.periapsisAltM > 0 && (
                <span className="muted">in {formatDuration(t.toPeriS)}</span>
              )}
            </dd>
            <dt>Period</dt>
            <dd>{el.status === 'escape' ? '—' : formatDuration(el.periodS)}</dd>
            <dt>Eccentricity</dt>
            <dd>{fmt(el.eccentricity, 4)}</dd>
          </dl>
        </>
      )}
      <OrbitInset snap={snap} el={el} />
      <p className="small-text muted inset-legend">
        <span className="dot ship" /> ship · <span className="dot splash" /> splash ·{' '}
        <span className="dot platform" /> platform · <span className="dot pad" /> pad. Map view (M):
        violet = apoapsis, red = periapsis.
      </p>
      <p className="footnote">
        Planar two-body model with a simple atmosphere; no Earth rotation. Stable orbit = periapsis
        ≥ {fmt(STABLE_PERIAPSIS_M / 1000)} km (game rule).
      </p>
    </div>
  );
}
