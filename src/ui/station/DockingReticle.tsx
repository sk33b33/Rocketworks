import type { ProximityView } from '../../station/proximitySession';
import { DOCK_WINDOW } from '../../station/proximity';

/** Docking-camera overlay: crosshair, the target's offset and the pointing error. */
export function DockingReticle({ view }: { view: ProximityView }) {
  const m = view.metrics;
  const s = view.state;
  const S = 240;
  const c = S / 2;
  // Lateral offset seen from the ship (scaled: full scale = 3 m), pointing error (full = 10°).
  const k = (c - 20) / 3;
  const tx = c + Math.max(-c + 10, Math.min(c - 10, s.p[2] * -k));
  const ty = c - Math.max(-c + 10, Math.min(c - 10, s.p[0] * k));
  const a = (c - 20) / 10;
  const px = c + Math.max(-c + 10, Math.min(c - 10, s.att.yaw * a));
  const py = c - Math.max(-c + 10, Math.min(c - 10, s.att.pitch * a));
  const good = m.lateralM <= DOCK_WINDOW.offsetM && m.angleErrDeg <= DOCK_WINDOW.angleDeg;
  return (
    <svg
      className="docking-reticle"
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label={`Docking alignment: ${m.lateralM.toFixed(2)} m off axis, ${m.angleErrDeg.toFixed(1)} degrees pointing error`}
    >
      <circle cx={c} cy={c} r={DOCK_WINDOW.offsetM * k} className="ret-window" />
      <line x1={c - 30} x2={c + 30} y1={c} y2={c} className="ret-cross" />
      <line y1={c - 30} y2={c + 30} x1={c} x2={c} className="ret-cross" />
      <g
        transform={`translate(${tx} ${ty}) rotate(${s.att.roll})`}
        className={good ? 'ret-target good' : 'ret-target'}
      >
        <line x1={-14} x2={14} y1={0} y2={0} />
        <line y1={-14} y2={14} x1={0} x2={0} />
        <circle r={6} />
      </g>
      <circle cx={px} cy={py} r={4} className="ret-attitude" />
    </svg>
  );
}
