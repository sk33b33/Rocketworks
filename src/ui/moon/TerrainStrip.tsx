import type { SiteTerrain } from '../../moon/lunarSites';
import { FLIGHT } from '../../flight/flightModel';

/**
 * Side view of the terrain along the ground track: height profile with steep stretches marked,
 * the site target, the assist's aim point and the ship. Colour is backed by a dashed pattern
 * for unsafe ground so it doesn't rely on colour alone.
 */
export function TerrainStrip({
  terrain,
  fromM,
  toM,
  aimM,
  ship,
}: {
  terrain: SiteTerrain;
  fromM: number;
  toM: number;
  aimM?: number | null;
  ship?: { x: number; heightM: number } | null;
}) {
  const W = 300;
  const H = 90;
  const prof = terrain.profile(fromM, toM, 120);
  const hs = prof.map((p) => p.h);
  const lo = Math.min(...hs) - 5;
  const hi = Math.max(...hs, ...(ship ? [ship.heightM] : [])) + 5;
  const sx = (x: number) => ((x - fromM) / (toM - fromM)) * W;
  const sy = (h: number) => H - 6 - ((h - lo) / Math.max(1, hi - lo)) * (H - 14);
  const ground = prof
    .map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.h).toFixed(1)}`)
    .join(' ');
  const steep = prof.filter((p) => p.slopeDeg > FLIGHT.lunarMaxLeanDeg * 0.75);
  const span = (toM - fromM) / 1000;
  return (
    <figure className="terrain-strip">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Terrain profile along the ground track">
        <defs>
          <pattern
            id="steep"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="2" height="4" fill="rgba(255,107,107,0.55)" />
          </pattern>
        </defs>
        <path d={`${ground} L${W},${H} L0,${H} Z`} className="ground" />
        {steep.map((p) => (
          <rect
            key={p.x}
            x={sx(p.x) - 1.5}
            y={sy(p.h) - 2}
            width={3}
            height={H - sy(p.h) + 2}
            fill="url(#steep)"
          />
        ))}
        <path d={ground} className="ground-line" />
        <line x1={sx(0)} x2={sx(0)} y1={4} y2={H} className="target-line" />
        {aimM !== null && aimM !== undefined && Math.abs(aimM) > 1 && (
          <line x1={sx(aimM)} x2={sx(aimM)} y1={4} y2={H} className="aim-line" />
        )}
        {ship && ship.x >= fromM && ship.x <= toM && (
          <polygon
            points={`${sx(ship.x)},${sy(ship.heightM) - 7} ${sx(ship.x) - 4},${sy(ship.heightM) + 3} ${sx(ship.x) + 4},${sy(ship.heightM) + 3}`}
            className="ship-mark"
          />
        )}
      </svg>
      <figcaption className="small-text muted">
        {span.toFixed(1)} km of ground track · <span className="tone-warn">hatched</span> = steeper
        than {Math.round(FLIGHT.lunarMaxLeanDeg * 0.75)}° ·{' '}
        <span className="target-key">yellow</span> target
        {aimM ? ' · blue = assist aim' : ''}
      </figcaption>
    </figure>
  );
}
