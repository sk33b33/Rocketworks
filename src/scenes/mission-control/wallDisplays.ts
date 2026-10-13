import type { MissionControlView } from './missionControlController';
import { POLL_LABELS } from '../../missions/missionReadiness';

/*
 * 2D drawing for the control-room wall screens. Pure canvas code (no Three.js), redrawn when the
 * mission plan changes. Status is always shown as text as well as colour.
 */

const C = {
  bg: '#05090f',
  grid: '#0f2233',
  text: '#d9e6f2',
  muted: '#7f93a8',
  accent: '#f0a830',
  go: '#3ddc84',
  hold: '#f0c030',
  nogo: '#ff5a4a',
  earth: '#1d5c9e',
  moon: '#9aa0a6',
};

const STATUS_COLOR = { go: C.go, hold: C.hold, 'no-go': C.nogo } as const;
const STATUS_TEXT = { go: 'GO', hold: 'HOLD', 'no-go': 'NO-GO' } as const;
const WEATHER_COLOR = { green: C.go, amber: C.hold, red: C.nogo } as const;
const WEATHER_TEXT = { green: 'GO', amber: 'MARGINAL', red: 'NO-GO' } as const;

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.fillStyle = C.accent;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 18, 14);
}

/** Main screen: mission name, overall status and a schematic trajectory to the destination. */
export function drawMainDisplay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: MissionControlView,
): void {
  const { report } = view;
  frame(ctx, w, h, 'MISSION OVERVIEW');
  // Status pill (drawn first so the title can be fitted beside it)
  const committed = view.commitState === 'committed';
  const label = committed
    ? 'COMMITTED · GO FOR ROLLOUT'
    : report.status === 'no-go'
      ? 'NO-GO'
      : report.status === 'go'
        ? 'GO'
        : 'GO (WARNINGS)';
  const color =
    committed || report.status === 'go' ? C.go : report.status === 'no-go' ? C.nogo : C.hold;
  ctx.font = 'bold 26px system-ui, sans-serif';
  const pw = ctx.measureText(label).width + 36;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(w - pw - 18, 18, pw, 44);
  ctx.fillStyle = color;
  ctx.fillText(label, w - pw, 27);

  // Mission title, shrunk to fit the space left of the pill
  const title = report.mission.name.toUpperCase();
  let size = 40;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  while (size > 22 && ctx.measureText(title).width > w - pw - 60) {
    size -= 2;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = C.text;
  ctx.fillText(title, 18, 46 + (40 - size) / 2);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillStyle = C.muted;
  ctx.fillText(
    `${report.mission.destinationLabel} · ${view.designName ? `Vehicle: ${view.designName}` : 'No vehicle assigned'} · Crew ${view.crewNames.length}`,
    18,
    94,
  );

  // Trajectory schematic
  const cy = h * 0.66;
  const ex = w * 0.22;
  const er = h * 0.2;
  ctx.fillStyle = C.earth;
  ctx.beginPath();
  ctx.arc(ex, cy, er, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('EARTH', ex - 26, cy + er + 10);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  switch (report.mission.destination) {
    case 'suborbital':
      ctx.moveTo(ex + er * 0.7, cy - er * 0.7);
      ctx.quadraticCurveTo(ex + er * 2.2, cy - er * 2.6, ex + er * 2.4, cy - er * 0.2);
      break;
    case 'leo':
    case 'station':
      ctx.ellipse(ex, cy, er * 1.5, er * 1.35, 0, 0, Math.PI * 2);
      break;
    default: {
      const mx = w * 0.8;
      ctx.moveTo(ex + er, cy);
      ctx.bezierCurveTo(w * 0.45, cy - h * 0.35, mx + 60, cy - h * 0.25, mx + 50, cy);
      ctx.bezierCurveTo(mx + 60, cy + h * 0.25, w * 0.45, cy + h * 0.35, ex + er, cy + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.moon;
      ctx.beginPath();
      ctx.arc(mx, cy, er * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      ctx.fillText('MOON', mx - 24, cy + er * 0.45 + 10);
      ctx.beginPath();
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (report.mission.destination === 'station') {
    ctx.fillStyle = C.text;
    ctx.fillRect(ex + er * 1.5 - 9, cy - 4, 18, 8);
    ctx.fillRect(ex + er * 1.5 - 2, cy - 14, 4, 28);
    ctx.fillText('STATION', ex + er * 1.5 + 16, cy - 10);
  }

  // Key numbers
  const dv = report.deltaV ? Math.round(report.deltaV.totalMs).toLocaleString('en-US') : '—';
  const lines = [
    `Δv est. ${dv} / ${report.requiredDeltaVMs.toLocaleString('en-US')} m/s`,
    `Payload + crew ${(report.carriedMassKg / 1000).toFixed(1)} t`,
    `Duration ${report.mission.durationDays} d · Risk ${report.risk.level.toUpperCase()}`,
    `Window opens T-${report.conditions.windowOpensInHours} h`,
  ];
  ctx.font = '22px system-ui, sans-serif';
  lines.forEach((line, i) => {
    ctx.fillStyle = C.text;
    ctx.fillText(line, w * 0.48, h * 0.4 + i * 34);
  });
}

/** Left screen: the flight director's go/no-go poll. */
export function drawPollDisplay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: MissionControlView,
): void {
  frame(ctx, w, h, 'GO / NO-GO POLL');
  ctx.font = '22px system-ui, sans-serif';
  view.report.poll.forEach((entry, i) => {
    const y = 58 + i * 32;
    ctx.fillStyle = C.text;
    ctx.fillText(POLL_LABELS[entry.area].toUpperCase(), 18, y);
    ctx.fillStyle = STATUS_COLOR[entry.status];
    ctx.fillRect(w - 128, y + 2, 12, 18);
    ctx.fillText(STATUS_TEXT[entry.status], w - 108, y);
  });
}

/** Right screen: weather, window and risk. */
export function drawWeatherDisplay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: MissionControlView,
): void {
  const c = view.report.conditions;
  frame(ctx, w, h, 'WEATHER & WINDOW');
  ctx.font = '20px system-ui, sans-serif';
  c.factors.forEach((f, i) => {
    const y = 56 + i * 30;
    ctx.fillStyle = C.text;
    ctx.fillText(`${f.label}: ${f.value}`, 18, y);
    ctx.fillStyle = WEATHER_COLOR[f.status];
    ctx.fillText(WEATHER_TEXT[f.status], w - 130, y);
  });
  ctx.fillStyle = WEATHER_COLOR[c.overall];
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText(`OVERALL ${WEATHER_TEXT[c.overall]} · window ${c.windowMinutes} min`, 18, h - 44);
}

/** Generic console screen texture (scrolling telemetry look). */
export function drawConsoleScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#04121c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1f7fbf';
  ctx.lineWidth = 2;
  for (let row = 0; row < 3; row++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = h * (0.25 + row * 0.25) + Math.sin(x * 0.05 + row * 2) * h * 0.06;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#3ddc84';
  for (let i = 0; i < 6; i++) ctx.fillRect(8 + i * 20, h - 14, 12, 6);
}
