import { describe, expect, it } from 'vitest';
import { PARTS, SOCKET_TYPE_LABELS } from '../src/rocket/catalog/parts';

describe('parts catalog', () => {
  it('has unique part ids and unique socket ids per part', () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    for (const part of PARTS) {
      expect(new Set(part.sockets.map((s) => s.id)).size, part.id).toBe(part.sockets.length);
    }
  });

  it('every attach type is provided by some socket (or is the stand)', () => {
    const provided = new Set(PARTS.flatMap((p) => p.sockets.map((s) => s.type)));
    provided.add('root');
    for (const part of PARTS) expect(provided.has(part.attachesTo), part.id).toBe(true);
  });

  it('has non-negative masses and costs and labels for every socket type', () => {
    for (const part of PARTS) {
      expect(part.dryMassKg).toBeGreaterThan(0);
      expect(part.costCredits).toBeGreaterThan(0);
      expect(SOCKET_TYPE_LABELS[part.attachesTo]).toBeTruthy();
    }
  });

  it('covers the Stage 1 catalog categories and has locked teasers', () => {
    const ids = PARTS.map((p) => p.id);
    for (const id of [
      'nose-cone',
      'crew-cabin',
      'cargo-bay',
      'ship-tank',
      'booster-tank',
      'engine-sl',
      'grid-fin',
      'flap-forward',
      'landing-leg',
      'docking-adapter',
      'hot-stage-interstage',
      'heat-shield',
      'plumbing-conduit',
      'access-hatch',
      'rcs-block',
      'antenna',
    ]) {
      expect(ids).toContain(id);
    }
    expect(PARTS.filter((p) => !p.unlock.unlocked).length).toBeGreaterThan(0);
  });
});
