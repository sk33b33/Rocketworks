import { describe, expect, it } from 'vitest';
import { compatibleTargets } from '../src/rocket/assembly/compatibility';
import { attachPart, removePart, replacePart } from '../src/rocket/assembly/operations';
import {
  createCompleteStarterDesign,
  createEmptyBlueprint,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { certificationStatus, certify } from '../src/rocket/readiness/certification';
import { estimateDeltaV, ORBIT_DELTA_V_MS } from '../src/rocket/readiness/deltaV';
import {
  evaluateReadiness,
  requiredDeltaV,
  type ReadinessContext,
} from '../src/rocket/readiness/readiness';
import { setRole } from '../src/rocket/library/blueprintLibrary';
import { STANDARD_GRAVITY_MS2 } from '../src/rocket/stats/calculateRocketStats';

const NOW = '2026-01-01T00:00:00.000Z';
const CTX: ReadinessContext = { unlockedPartIds: new Set(), budgetCredits: 1_000_000 };
const ALL_UNLOCKED: ReadinessContext = {
  unlockedPartIds: new Set(['engine-vac', 'engine-sl-b2', 'ship-tank-extended', 'solar-array']),
  budgetCredits: 1_000_000,
};

const ids = (bp: RocketBlueprint, ctx = CTX) => evaluateReadiness(bp, ctx).issues.map((i) => i.id);
const removeAll = (bp: RocketBlueprint, partId: string) => {
  let cur = bp;
  for (const p of bp.parts.filter((x) => x.partId === partId)) {
    const r = removePart(cur, p.id, NOW);
    if (r.ok) cur = r.blueprint;
  }
  return cur;
};

describe('estimateDeltaV', () => {
  it('is zero without engines and matches the rocket equation per stage', () => {
    expect(estimateDeltaV(createStarterBlueprint(NOW)).totalMs).toBe(0);
    const dv = estimateDeltaV(createCompleteStarterDesign(NOW));
    const b = dv.booster;
    expect(b.ispS).toBeCloseTo(340, 6); // average of 330 SL / 350 vac
    expect(b.deltaVMs).toBeCloseTo(
      STANDARD_GRAVITY_MS2 * 340 * Math.log(b.initialMassKg / b.finalMassKg),
      6,
    );
    expect(dv.ship.ispS).toBeCloseTo(350, 6);
    expect(dv.totalMs).toBeGreaterThan(ORBIT_DELTA_V_MS);
  });
});

describe('evaluateReadiness', () => {
  it('passes the complete reference design (crew role) with no critical issues', () => {
    const report = evaluateReadiness(createCompleteStarterDesign(NOW), CTX);
    expect(report.criticalCount).toBe(0);
    expect(report.status).not.toBe('blocked');
    expect(report.capabilities.find((c) => c.id === 'orbit')?.available).toBe(true);
  });

  it('flags an empty stand only', () => {
    expect(ids(createEmptyBlueprint(NOW))).toEqual(['empty']);
  });

  it('flags the bare starter section with the core structural problems', () => {
    const found = ids(createStarterBlueprint(NOW));
    for (const id of ['no-booster-engines', 'booster-open', 'no-ship', 'crew-cabin'])
      expect(found).toContain(id);
    expect(evaluateReadiness(createStarterBlueprint(NOW), CTX).status).toBe('blocked');
  });

  it('detects missing nose, ship engines, partial engines and recovery hardware', () => {
    const full = createCompleteStarterDesign(NOW);
    expect(ids(removeAll(full, 'nose-cone'))).toContain('ship-open-top');
    const noLegs = ids(removeAll(full, 'landing-leg'));
    expect(noLegs).toContain('no-recovery');
    const oneEngine = full.parts.find(
      (p) => p.partId === 'engine-sl' && p.parent.parentId === 'p1',
    )!;
    const r = removePart(full, oneEngine.id, NOW);
    if (!r.ok) throw new Error();
    expect(ids(r.blueprint)).toContain('booster-engines-partial');
    const aft = full.parts.find((p) => p.partId === 'ship-aft-section')!;
    let noShipEngines = full;
    for (const e of full.parts.filter(
      (p) => p.parent.parentId === aft.id && p.partId === 'engine-sl',
    )) {
      const x = removePart(noShipEngines, e.id, NOW);
      if (x.ok) noShipEngines = x.blueprint;
    }
    expect(ids(noShipEngines)).toContain('ship-no-engines');
  });

  it('makes heat shield and flaps critical for crew but warnings for cargo', () => {
    const bare = removeAll(removeAll(createCompleteStarterDesign(NOW), 'heat-shield'), 'flap-aft');
    const crew = evaluateReadiness(bare, CTX).issues;
    expect(crew.find((i) => i.id === 'heat-shield-gaps')?.severity).toBe('critical');
    expect(crew.find((i) => i.id === 'flaps')?.severity).toBe('critical');
    const cargo = evaluateReadiness(setRole(bare, 'cargo', NOW), CTX).issues;
    expect(cargo.find((i) => i.id === 'heat-shield-gaps')?.severity).toBe('warning');
    expect(cargo.find((i) => i.id === 'flaps')?.severity).toBe('warning');
  });

  it('requires a crew cabin for crew role and suggests a payload bay for cargo', () => {
    const noCabin = removeAll(createCompleteStarterDesign(NOW), 'crew-cabin');
    expect(ids(noCabin)).toContain('crew-cabin');
    const cargo = setRole(noCabin, 'cargo', NOW);
    expect(ids(cargo)).not.toContain('crew-cabin');
    expect(ids(cargo)).toContain('no-payload');
    expect(requiredDeltaV('crew')).toBeGreaterThan(requiredDeltaV('cargo'));
  });

  it('flags too little thrust and too little propellant', () => {
    const full = createCompleteStarterDesign(NOW);
    // Keep only 3 booster engines -> liftoff TWR below 1.
    let weak = full;
    for (const e of full.parts
      .filter((p) => p.partId === 'engine-sl' && p.parent.parentId === 'p1')
      .slice(3)) {
      const r = removePart(weak, e.id, NOW);
      if (r.ok) weak = r.blueprint;
    }
    expect(ids(weak)).toContain('twr-low');
    // Remove both ship tanks (and what sits above them) -> no nose, so also check Δv on a shorter ship.
    const tank = full.parts.find((p) => p.partId === 'ship-tank')!;
    const swapped = replacePart(full, tank.id, 'cargo-bay', NOW);
    if (!swapped.ok) throw new Error(swapped.reason);
    const report = evaluateReadiness(swapped.blueprint, CTX);
    expect(report.deltaV.totalMs).toBeLessThan(evaluateReadiness(full, CTX).deltaV.totalMs);
  });

  it('reports a Δv shortfall as critical', () => {
    const full = createCompleteStarterDesign(NOW);
    let bp = full;
    for (const id of ['booster-tank', 'ship-tank']) {
      const t = bp.parts.find(
        (p) => p.partId === id && bp.parts.some((q) => q.parent.parentId === p.id),
      );
      if (!t) continue;
      const r = replacePart(
        bp,
        t.id,
        id === 'booster-tank' ? 'booster-tank-short' : 'cargo-bay',
        NOW,
      );
      if (r.ok) bp = r.blueprint;
    }
    const report = evaluateReadiness(bp, CTX);
    if (report.deltaV.totalMs < report.requiredDeltaVMs) expect(ids(bp)).toContain('delta-v');
    else expect(ids(bp)).not.toContain('delta-v');
  });

  it('warns about vacuum engines on the booster and blocks unresearched parts', () => {
    const full = createCompleteStarterDesign(NOW);
    const engine = full.parts.find((p) => p.partId === 'engine-sl' && p.parent.parentId === 'p1')!;
    const r = replacePart(full, engine.id, 'engine-vac', NOW, ALL_UNLOCKED.unlockedPartIds);
    if (!r.ok) throw new Error(r.reason);
    expect(ids(r.blueprint, ALL_UNLOCKED)).toContain('vac-on-booster');
    expect(ids(r.blueprint, ALL_UNLOCKED)).not.toContain('locked-parts');
    expect(ids(r.blueprint, CTX)).toContain('locked-parts');
  });

  it('flags asymmetric grid fins and an over-budget design', () => {
    const full = createCompleteStarterDesign(NOW);
    const fin = full.parts.find((p) => p.partId === 'grid-fin')!;
    const r = removePart(full, fin.id, NOW);
    if (!r.ok) throw new Error();
    expect(ids(r.blueprint)).toContain('grid-fins-asymmetric');
    expect(ids(full, { ...CTX, budgetCredits: 1000 })).toContain('over-budget');
  });

  it('sorts critical issues first and offers a fix action for each critical issue', () => {
    const report = evaluateReadiness(createStarterBlueprint(NOW), CTX);
    const firstWarning = report.issues.findIndex((i) => i.severity === 'warning');
    const lastCritical = report.issues.map((i) => i.severity).lastIndexOf('critical');
    if (firstWarning >= 0) expect(lastCritical).toBeLessThan(firstWarning);
    for (const i of report.issues.filter((x) => x.severity === 'critical'))
      expect(i.fix.length).toBeGreaterThan(0);
  });
});

describe('certification', () => {
  it('refuses blocked designs unless overridden, and expires on change', () => {
    const starter = createStarterBlueprint(NOW);
    const blocked = evaluateReadiness(starter, CTX);
    expect(certify(starter, blocked, false, NOW).ok).toBe(false);
    const forced = certify(starter, blocked, true, NOW);
    if (!forced.ok) throw new Error();
    expect(certificationStatus(forced.blueprint)).toBe('override');

    const full = createCompleteStarterDesign(NOW);
    const ok = certify(full, evaluateReadiness(full, CTX), false, NOW);
    if (!ok.ok) throw new Error(ok.reason);
    expect(certificationStatus(ok.blueprint)).toBe('valid');
    expect(ok.blueprint.revision).toBe(full.revision);
    const slot = compatibleTargets(ok.blueprint, 'antenna')[0]!;
    const changed = attachPart(ok.blueprint, 'antenna', slot.ref, NOW);
    if (!changed.ok) throw new Error(changed.reason);
    expect(certificationStatus(changed.blueprint)).toBe('expired');
    expect(certificationStatus(setRole(ok.blueprint, 'cargo', NOW))).toBe('expired');
    expect(certificationStatus(full)).toBe('none');
  });
});
