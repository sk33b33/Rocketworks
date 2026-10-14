import { describe, expect, it } from 'vitest';
import { getAvailability, getLocation, isLocationId, LOCATIONS } from '../src/app/locations';

describe('locations', () => {
  it('has unique ids', () => {
    expect(new Set(LOCATIONS.map((l) => l.id)).size).toBe(LOCATIONS.length);
  });

  it('only the factory is available in stage 0', () => {
    const available = LOCATIONS.filter((l) => getAvailability(l.id, 0).available).map((l) => l.id);
    expect(available).toEqual(['factory']);
  });

  it('locked locations carry a reason', () => {
    for (const loc of LOCATIONS) {
      const a = getAvailability(loc.id, 0);
      if (!a.available) expect(a.reason).toMatch(/later stage/);
    }
  });

  it('unlocks by stage', () => {
    expect(getAvailability('mission-control', 3).available).toBe(true);
    expect(getAvailability('launch-pad', 3).available).toBe(false);
  });

  it('validates ids', () => {
    expect(isLocationId('factory')).toBe(true);
    expect(isLocationId('venus')).toBe(false);
    expect(isLocationId(42)).toBe(false);
    expect(() => getLocation('nope' as never)).toThrow();
  });
});
