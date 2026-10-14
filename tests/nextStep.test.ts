import { describe, expect, it } from 'vitest';
import { nextStep } from '../src/progression/nextStep';
import {
  createCompleteStarterDesign,
  createStarterBlueprint,
} from '../src/rocket/catalog/blueprints';
import { certify } from '../src/rocket/readiness/certification';
import { readinessReport } from '../src/app/store/derived';
import { INITIAL_PROGRESSION } from '../src/progression/research';

const NOW = '2026-01-01T00:00:00.000Z';

describe('next step hint', () => {
  const base = {
    completedMissionIds: [] as string[],
    missionCommitted: false,
    flightAt: null,
    launchActive: false,
  };
  const certified = () => {
    const bp = createCompleteStarterDesign(NOW);
    const r = certify(bp, readinessReport(bp, INITIAL_PROGRESSION), true, NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.blueprint;
  };

  it('walks the loop from the factory to the next mission', () => {
    expect(nextStep({ ...base, blueprints: [createStarterBlueprint(NOW)] }).location).toBe(
      'factory',
    );
    const bp = certified();
    expect(nextStep({ ...base, blueprints: [bp] })).toMatchObject({
      location: 'mission-control',
      text: 'Next mission: Uncrewed Test Flight',
    });
    expect(nextStep({ ...base, blueprints: [bp], missionCommitted: true }).location).toBe(
      'launch-pad',
    );
    expect(nextStep({ ...base, blueprints: [bp], completedMissionIds: ['test-flight'] }).text).toBe(
      'Next mission: Crewed Orbital Shakedown',
    );
  });

  it('points at a flight or launch in progress first', () => {
    const bp = certified();
    expect(nextStep({ ...base, blueprints: [bp], flightAt: 'moon' }).location).toBe('moon');
    expect(nextStep({ ...base, blueprints: [bp], launchActive: true }).location).toBe('launch-pad');
  });
});
