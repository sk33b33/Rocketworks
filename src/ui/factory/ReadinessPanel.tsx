import { useState } from 'react';
import { selectReadiness, useGameStore } from '../../app/gameStore';
import { VEHICLE_ROLES } from '../../rocket/model/finish';
import { certificationStatus } from '../../rocket/readiness/certification';
import { formatSpeed } from '../format';

const STATUS_TEXT = {
  ready: { icon: '✓', label: 'Ready for flight', tone: 'ok' },
  warnings: { icon: '!', label: 'Flyable with warnings', tone: 'warn' },
  blocked: { icon: '✕', label: 'Not flight-ready', tone: 'bad' },
} as const;

export function CertificationBadge() {
  const bp = useGameStore((s) => s.blueprint);
  const status = certificationStatus(bp);
  const text = {
    none: { label: 'Not certified', tone: 'muted' },
    valid: { label: '✓ Certified', tone: 'tone-ok' },
    override: { label: '! Certified (override)', tone: 'tone-warn' },
    expired: { label: 'Certification expired', tone: 'tone-warn' },
  }[status];
  return <span className={`cert-badge ${text.tone}`}>{text.label}</span>;
}

/** Vehicle readiness report with actionable fixes and the flight-certification gate. */
export function ReadinessPanel() {
  const report = useGameStore(selectReadiness);
  const bp = useGameStore((s) => s.blueprint);
  const setRole = useGameStore((s) => s.setRole);
  const certify = useGameStore((s) => s.certify);
  const runFix = useGameStore((s) => s.runFixAction);
  const [override, setOverride] = useState(false);
  const status = STATUS_TEXT[report.status];
  const cert = certificationStatus(bp);
  const dvShare = Math.min(1, report.deltaV.totalMs / report.requiredDeltaVMs);
  const blocked = report.status === 'blocked';
  const certifyReason =
    blocked && !override
      ? 'Fix the critical issues first, or tick the tutorial override.'
      : undefined;

  return (
    <div className="readiness">
      <fieldset className="role-picker">
        <legend className="eyebrow">Design role</legend>
        {VEHICLE_ROLES.map((r) => (
          <label key={r.id} title={r.description}>
            <input
              type="radio"
              name="role"
              checked={bp.role === r.id}
              onChange={() => setRole(r.id)}
            />
            {r.name}
          </label>
        ))}
      </fieldset>

      <div className={`status-banner tone-${status.tone}`} role="status">
        <span aria-hidden="true">{status.icon}</span> {status.label}
        <span className="muted">
          {' '}
          · {report.criticalCount} critical, {report.warningCount} warning
          {report.warningCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="dv">
        <div className="row">
          <span>Est. Δv to orbit</span>
          <strong className={dvShare >= 1 ? 'tone-ok' : 'tone-bad'}>
            {formatSpeed(report.deltaV.totalMs)} / {formatSpeed(report.requiredDeltaVMs)}
          </strong>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Delta-v versus requirement"
          aria-valuenow={Math.round(dvShare * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`progress-fill ${dvShare >= 1 ? '' : 'fill-bad'}`}
            style={{ width: `${dvShare * 100}%` }}
          />
        </div>
        <p className="footnote">
          Booster {formatSpeed(report.deltaV.booster.deltaVMs)} + ship{' '}
          {formatSpeed(report.deltaV.ship.deltaVMs)}. Ideal rocket equation with game-tuned values;
          losses are folded into the requirement.
        </p>
      </div>

      {report.issues.length > 0 && (
        <ul className="issues">
          {report.issues.map((issue) => (
            <li key={issue.id} className={`issue issue-${issue.severity}`}>
              <div className="issue-title">
                <span aria-hidden="true">{issue.severity === 'critical' ? '✕' : '!'}</span>
                <span className="sr-only">{issue.severity}: </span>
                {issue.title}
              </div>
              <p>{issue.detail}</p>
              <p className="fix">
                <strong>Fix:</strong> {issue.fix}
              </p>
              {issue.action && (
                <button type="button" onClick={() => runFix(issue.action!)}>
                  {issue.actionLabel ?? 'Fix'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="eyebrow section-gap">Capabilities</div>
      <ul className="capabilities">
        {report.capabilities.map((c) => (
          <li key={c.id} className={c.available ? 'tone-ok' : 'muted'}>
            <span aria-hidden="true">{c.available ? '✓' : '✕'}</span>
            <span className="sr-only">{c.available ? 'Yes: ' : 'No: '}</span> {c.label}
          </li>
        ))}
      </ul>

      <div className="certify">
        <div className="row">
          <span className="eyebrow">Flight certification</span>
          <CertificationBadge />
        </div>
        {cert === 'expired' && (
          <p className="hint">The design changed since it was certified. Re-certify it.</p>
        )}
        {blocked && (
          <label className="override">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Tutorial override: certify despite critical issues (flights may fail)
          </label>
        )}
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={!!certifyReason || cert === 'valid'}
            title={certifyReason ?? (cert === 'valid' ? 'Already certified.' : undefined)}
            onClick={() => certify(override)}
          >
            {blocked
              ? 'Certify with override'
              : cert === 'valid'
                ? 'Certified'
                : 'Certify for flight'}
          </button>
        </div>
        {certifyReason && <p className="hint">{certifyReason}</p>}
        <p className="footnote">Mission Control only flies certified designs.</p>
      </div>
    </div>
  );
}
