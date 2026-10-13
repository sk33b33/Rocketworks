import type { RocketBlueprint } from '../model/types';
import type { ReadinessReport } from './readiness';

export type CertificationStatus = 'none' | 'valid' | 'override' | 'expired';

/** A certification is only valid for the exact revision (and role) it was issued for. */
export function certificationStatus(bp: RocketBlueprint): CertificationStatus {
  const cert = bp.certification;
  if (!cert) return 'none';
  if (cert.revision !== bp.revision || cert.role !== bp.role) return 'expired';
  return cert.override ? 'override' : 'valid';
}

/**
 * Certifies the design for flight. Blocked designs are refused unless `override` is set (tutorial
 * override), in which case the certification is marked as overridden. Does not bump the revision.
 */
export function certify(
  bp: RocketBlueprint,
  report: ReadinessReport,
  override: boolean,
  now: string,
): { ok: true; blueprint: RocketBlueprint } | { ok: false; reason: string } {
  if (report.status === 'blocked' && !override) {
    const n = report.criticalCount;
    return {
      ok: false,
      reason: `Certification refused: ${n} critical issue${n > 1 ? 's' : ''} remain. Fix them or use the tutorial override.`,
    };
  }
  return {
    ok: true,
    blueprint: {
      ...bp,
      certification: {
        revision: bp.revision,
        role: bp.role,
        override: report.status === 'blocked',
        at: now,
      },
    },
  };
}
