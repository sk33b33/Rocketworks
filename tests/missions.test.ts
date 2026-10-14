import { describe, expect, it } from 'vitest';
import {
  generateConditions,
  initialConditionsSeed,
  nextWindowSeed,
} from '../src/missions/conditions';
import { CREW_MASS_KG, CREW_ROSTER } from '../src/missions/crew';
import {
  findMission,
  missionAvailability,
  MISSIONS,
  PAYLOADS,
} from '../src/missions/missionCatalog';
import {
  commitMission,
  commitState,
  evaluateMission,
  type MissionContext,
} from '../src/missions/missionReadiness';
import {
  createDefaultSetup,
  selectMission,
  setPayload,
  toggleCrew,
  waitForNextWindow,
  type MissionSetup,
} from '../src/missions/missionSetup';
import {
  budgetCredits,
  completeMission,
  INITIAL_PROGRESSION,
  researchAvailable,
} from '../src/progression/research';
import { attachPart, removePart } from '../src/rocket/assembly/operations';
import { compatibleTargets } from '../src/rocket/assembly/compatibility';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { setRole } from '../src/rocket/library/blueprintLibrary';
import type { RocketBlueprint } from '../src/rocket/model/types';
import { certify } from '../src/rocket/readiness/certification';
import { estimateDeltaV } from '../src/rocket/readiness/deltaV';
import { evaluateReadiness } from '../src/rocket/readiness/readiness';

const NOW = '2026-01-01T00:00:00.000Z';
const VCTX = { unlockedPartIds: new Set<string>(), budgetCredits: 1e9 };

function certified(bp: RocketBlueprint, override = false): RocketBlueprint {
  const r = certify(bp, evaluateReadiness(bp, VCTX), override, NOW);
  if (!r.ok) throw new Error(r.reason);
  return r.blueprint;
}

/** A setup whose weather is green (deterministic search over windows). */
function greenSetup(base: MissionSetup): MissionSetup {
  let s = base;
  for (let i = 0; i < 200 && generateConditions(s.conditionsSeed).overall !== 'green'; i++)
    s = waitForNextWindow(s);
  expect(generateConditions(s.conditionsSeed).overall).toBe('green');
  return s;
}

function ctx(
  setup: MissionSetup,
  bp: RocketBlueprint | undefined,
  completed: string[] = [],
): MissionContext {
  return {
    setup,
    blueprint: bp,
    vehicleReport: bp ? evaluateReadiness(bp, VCTX) : undefined,
    completedMissionIds: completed,
  };
}
const ids = (c: MissionContext) => evaluateMission(c).issues.map((i) => i.id);

function orbitalSetup(bp: RocketBlueprint, crew = ['okafor', 'lindqvist']): MissionSetup {
  let s = createDefaultSetup(bp.id);
  const sel = selectMission(s, 'orbital-flight', []);
  if (!sel.ok) throw new Error(sel.reason);
  s = sel.setup;
  for (const c of crew) {
    const r = toggleCrew(s, c);
    if (!r.ok) throw new Error(r.reason);
    s = r.setup;
  }
  return greenSetup(s);
}

describe('mission catalog', () => {
  it('has unique ids, valid payload references and offers a no-payload option', () => {
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(MISSIONS.length);
    for (const m of MISSIONS) {
      // Mars flights carry the propellant plant (cargo) or the crew's supplies (round trip).
      if (m.mars) expect(m.payloadIds).toEqual([m.mars.plantPayloadId ?? m.mars.suppliesPayloadId]);
      else expect(m.payloadIds).toContain('none');
      for (const p of m.payloadIds)
        expect(
          PAYLOADS.some((x) => x.id === p),
          `${m.id}/${p}`,
        ).toBe(true);
      if (m.unlock.kind === 'after')
        for (const id of m.unlock.missionIds) expect(findMission(id)).toBeDefined();
    }
  });

  it('unlocks missions progressively', () => {
    const station = findMission('station-docking')!;
    expect(missionAvailability(findMission('test-flight')!, []).available).toBe(true);
    expect(missionAvailability(findMission('orbital-flight')!, []).available).toBe(true);
    const locked = missionAvailability(station, []);
    expect(locked.available === false && locked.reason).toMatch(/Crewed Orbital Shakedown/);
    expect(missionAvailability(station, ['orbital-flight']).available).toBe(true);
    expect(missionAvailability(findMission('lunar-landing')!, ['station-docking']).available).toBe(
      false,
    );
    expect(
      missionAvailability(
        findMission('lunar-landing')!,
        MISSIONS.map((m) => m.id),
      ).available,
    ).toBe(true);
  });

  it('roster is fictional-only data with valid skills and at least one unavailable astronaut', () => {
    for (const c of CREW_ROSTER) expect(c.skill).toBeGreaterThanOrEqual(1);
    expect(CREW_ROSTER.some((c) => c.status === 'medical-hold')).toBe(true);
  });
});

describe('mission setup', () => {
  it('refuses locked missions and trims crew/payload when switching', () => {
    const bp = createCompleteStarterDesign(NOW);
    const s = orbitalSetup(bp);
    expect(selectMission(s, 'station-docking', []).ok).toBe(false);
    const withPod = setPayload(s, 'science-pod');
    if (!withPod.ok) throw new Error();
    const toTest = selectMission(withPod.setup, 'test-flight', []);
    if (!toTest.ok) throw new Error();
    expect(toTest.setup.crewIds).toEqual([]);
    expect(toTest.setup.payloadId).toBe('none');
    expect(toTest.setup.conditionsSeed).toBe(initialConditionsSeed('test-flight'));
  });

  it('enforces crew assignment rules', () => {
    const base = createDefaultSetup(null);
    expect(toggleCrew(base, 'okafor')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/uncrewed/),
    });
    const orbital = selectMission(base, 'orbital-flight', []);
    if (!orbital.ok) throw new Error();
    expect(toggleCrew(orbital.setup, 'adeyemi')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/medical hold/),
    });
    let s = orbital.setup;
    for (const c of ['alvarez', 'okafor']) {
      const r = toggleCrew(s, c);
      if (!r.ok) throw new Error();
      s = r.setup;
    }
    expect(s.crewIds).toEqual(['okafor', 'alvarez']); // roster order
    const removed = toggleCrew(s, 'okafor');
    expect(removed.ok && removed.setup.crewIds).toEqual(['alvarez']);
    expect(setPayload(s, 'station-supplies').ok).toBe(false);
  });

  it('every planning change clears an existing commitment', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    const s = { ...orbitalSetup(bp), commit: { designId: bp.id, revision: bp.revision, at: NOW } };
    expect(waitForNextWindow(s).commit).toBeNull();
    const t = toggleCrew(s, 'raman');
    expect(t.ok && t.setup.commit).toBeNull();
  });
});

describe('launch conditions', () => {
  it('is deterministic per seed and the next window differs', () => {
    const a = generateConditions(1234);
    expect(generateConditions(1234)).toEqual(a);
    expect(nextWindowSeed(1234)).not.toBe(1234);
  });

  it('rates lightning or extreme wind as red, near-limit values as amber', () => {
    let sawRed = false;
    let sawAmber = false;
    let seed = 1;
    for (let i = 0; i < 300; i++) {
      const c = generateConditions(seed);
      const reds = c.factors.filter((f) => f.status === 'red');
      if (c.overall === 'red') {
        sawRed = true;
        expect(reds.length).toBeGreaterThan(0);
      }
      if (c.overall === 'amber') {
        sawAmber = true;
        expect(reds).toHaveLength(0);
      }
      seed = nextWindowSeed(seed);
    }
    expect(sawRed && sawAmber).toBe(true);
  });
});

describe('evaluateMission', () => {
  it('is GO for the certified reference design on a crewed orbital flight', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    const report = evaluateMission(ctx(orbitalSetup(bp), bp));
    expect(report.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    expect(report.status).not.toBe('no-go');
    expect(report.poll.every((p) => p.status !== 'no-go')).toBe(true);
  });

  it('requires an assigned, certified (unexpired) vehicle', () => {
    const bp = createCompleteStarterDesign(NOW);
    expect(ids(ctx(orbitalSetup(bp), undefined))).toContain('no-design');
    expect(ids(ctx(orbitalSetup(bp), bp))).toContain('not-certified');
    const cert = certified(bp);
    const slot = compatibleTargets(cert, 'access-hatch')[0]!;
    const changed = attachPart(cert, 'access-hatch', slot.ref, NOW);
    if (!changed.ok) throw new Error();
    expect(evaluateMission(ctx(orbitalSetup(bp), changed.blueprint)).issues[0]?.title).toMatch(
      /expired/,
    );
  });

  it('flags override certification as a risk warning', () => {
    const forced = certified(createStarterBlueprint(NOW), true);
    const s = greenSetup(createDefaultSetup(forced.id));
    const r = evaluateMission(ctx(s, forced));
    expect(r.issues.find((i) => i.id === 'override-cert')?.severity).toBe('warning');
    expect(r.risk.factors.join(' ')).toMatch(/override/);
  });

  it('checks crew size, seats, roles, status and life support', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    expect(ids(ctx(orbitalSetup(bp, []), bp))).toContain('crew-min');
    expect(ids(ctx(orbitalSetup(bp, ['okafor', 'raman']), bp))).toContain('crew-pilot');
    const fatigued = evaluateMission(ctx(orbitalSetup(bp, ['okafor', 'voss']), bp));
    expect(fatigued.issues.find((i) => i.id === 'crew-fatigue-voss')?.severity).toBe('warning');
    // Medical hold can only appear via old saves; it must still be caught.
    const held = { ...orbitalSetup(bp), crewIds: ['okafor', 'lindqvist', 'adeyemi'] };
    expect(ids(ctx(held, bp))).toContain('crew-medical-adeyemi');
    // 8 crew × 3 days = 24 crew-days < 60: fine. Remove the cabin -> seats and life support fail.
    const cabin = bp.parts.find((p) => p.partId === 'crew-cabin')!;
    const noCabin = removePart(bp, cabin.id, NOW);
    if (!noCabin.ok) throw new Error();
    const found = ids(ctx(orbitalSetup(bp), noCabin.blueprint));
    expect(found).toEqual(expect.arrayContaining(['crew-seats', 'life-support']));
  });

  it('requires a crew-role vehicle for crewed missions', () => {
    const cargo = certified(setRole(createCompleteStarterDesign(NOW), 'cargo', NOW));
    expect(ids(ctx(orbitalSetup(cargo), cargo))).toContain('role-mismatch');
  });

  it('accounts for payload and crew mass in Δv and payload bay needs', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    const s = orbitalSetup(bp);
    const sat = setPayload(s, 'comms-sat');
    if (!sat.ok) throw new Error();
    const report = evaluateMission(ctx(sat.setup, bp));
    expect(report.carriedMassKg).toBe(12_000 + 2 * CREW_MASS_KG);
    expect(report.deltaV!.totalMs).toBeLessThan(estimateDeltaV(bp).totalMs);
    expect(report.issues.map((i) => i.id)).toContain('payload-bay');
  });

  it('reports a Δv shortfall for missions the design cannot reach', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    let s = createDefaultSetup(bp.id);
    s = { ...s, missionId: 'lunar-transfer', crewIds: ['okafor', 'lindqvist'] };
    const found = ids(ctx(greenSetup(s), bp, ['orbital-flight', 'station-docking']));
    expect(found).toContain('lunar-dv-trip');
    // Orbital refuelling fills the tanks for the trip.
    const fueled = { ...s, refuel: { leo: true, depot: false } };
    expect(ids(ctx(greenSetup(fueled), bp, ['orbital-flight', 'station-docking']))).not.toContain(
      'lunar-dv-trip',
    );
  });

  it('station missions need a docking adapter and RCS', () => {
    const bp = createCompleteStarterDesign(NOW);
    let stripped = bp;
    for (const id of ['docking-adapter', 'rcs-block']) {
      const p = stripped.parts.find((x) => x.partId === id)!;
      const r = removePart(stripped, p.id, NOW);
      if (r.ok) stripped = r.blueprint;
    }
    const cert = certified(stripped);
    const s = greenSetup({
      ...createDefaultSetup(cert.id),
      missionId: 'station-docking',
      crewIds: ['okafor', 'lindqvist'],
    });
    const found = evaluateMission(ctx(s, cert, ['orbital-flight'])).issues;
    expect(found.find((i) => i.id === 'docking')?.severity).toBe('critical');
    expect(found.find((i) => i.id === 'rcs')?.severity).toBe('critical');
  });

  it('turns red weather into a blocking item with a wait action', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    let s = orbitalSetup(bp);
    for (let i = 0; i < 300 && generateConditions(s.conditionsSeed).overall !== 'red'; i++)
      s = waitForNextWindow(s);
    const issue = evaluateMission(ctx(s, bp)).issues.find((i) => i.id === 'weather-red');
    expect(issue?.severity).toBe('critical');
    expect(issue?.action).toEqual({ kind: 'wait-window' });
  });
});

describe('commitment', () => {
  it('commits only when GO and voids when the design changes', () => {
    const bp = certified(createCompleteStarterDesign(NOW));
    const s = orbitalSetup(bp);
    const noGo = evaluateMission(ctx(orbitalSetup(bp, []), bp));
    expect(commitMission(orbitalSetup(bp, []), bp, noGo, NOW).ok).toBe(false);
    const report = evaluateMission(ctx(s, bp));
    const c = commitMission(s, bp, report, NOW);
    if (!c.ok) throw new Error(c.reason);
    expect(commitState(c.setup, bp, report)).toBe('committed');
    const changed = { ...bp, revision: bp.revision + 1 };
    expect(commitState(c.setup, changed, evaluateMission(ctx(c.setup, changed)))).toBe('void');
    expect(commitState(s, bp, report)).toBe('planning');
  });
});

describe('mission rewards', () => {
  it('pays RP and budget once per mission', () => {
    const r = completeMission(INITIAL_PROGRESSION, 'test-flight');
    if (!r.ok) throw new Error();
    expect(r.firstTime).toBe(true);
    expect(researchAvailable(r.progression)).toBe(2);
    expect(budgetCredits(r.progression) - budgetCredits(INITIAL_PROGRESSION)).toBe(20_000);
    const again = completeMission(r.progression, 'test-flight');
    expect(again.ok && again.firstTime).toBe(false);
    expect(again.ok && again.progression).toBe(r.progression);
    expect(completeMission(INITIAL_PROGRESSION, 'mars').ok).toBe(false);
  });
});
