import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ART_SIZE,
  artUrl,
  FACTORY_SIGNS,
  LOCATION_ICONS,
  patchFor,
  PIXEL_ART_DIR,
  portraitFor,
  STORY_PATCHES,
} from '../src/art/pixelArt';
import { LOCATIONS } from '../src/app/locations';
import { CREW_ROSTER } from '../src/missions/crew';
import { MISSIONS } from '../src/missions/missionCatalog';
import { CONTRACT_MISSION, type ContractKind } from '../src/economy/contracts';

/** The built sprite on disk (public/ is served at the app's base URL). */
const file = (name: string) => join(__dirname, '..', 'public', PIXEL_ART_DIR, `${name}.png`);

/** Width and height from a PNG header. */
function pngSize(name: string): [number, number] {
  const b = readFileSync(file(name));
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('pixel art', () => {
  it('builds URLs under the base URL', () => {
    expect(artUrl('logo')).toBe('/art/sprites/logo.png');
  });

  it('has an icon for every location', () => {
    for (const loc of LOCATIONS) {
      const name = LOCATION_ICONS[loc.id];
      expect(existsSync(file(name)), name).toBe(true);
      expect(pngSize(name)).toEqual(ART_SIZE.icon);
    }
  });

  it('has a patch for every story mission and every contract kind', () => {
    for (const id of STORY_PATCHES)
      expect(
        MISSIONS.some((m) => m.id === id),
        id,
      ).toBe(true);
    for (const m of MISSIONS) {
      const name = patchFor(m.id);
      expect(name, m.id).not.toBeNull();
      expect(existsSync(file(name!)), name!).toBe(true);
      expect(pngSize(name!)).toEqual(ART_SIZE.patch);
    }
    for (const kind of Object.keys(CONTRACT_MISSION) as ContractKind[]) {
      expect(existsSync(file(`patch_${kind}`)), kind).toBe(true);
      expect(patchFor(CONTRACT_MISSION[kind])).toBe(`patch_${kind}`);
    }
    expect(patchFor('no-such-mission')).toBeNull();
  });

  it('has a portrait for every crew member', () => {
    for (const c of CREW_ROSTER) {
      const name = portraitFor(c.id)!;
      expect(existsSync(file(name)), name).toBe(true);
      expect(pngSize(name)).toEqual(ART_SIZE.portrait);
    }
    expect(portraitFor('nobody')).toBeNull();
  });

  it('has the logo, the favicon and the factory signs, sized to their art', () => {
    expect(pngSize('logo')).toEqual(ART_SIZE.logo);
    expect(pngSize('favicon')).toEqual([16, 16]);
    for (const sign of FACTORY_SIGNS) {
      const [w, h] = pngSize(sign.sprite);
      // Same aspect ratio as the art, so pixels stay square on the wall.
      expect(sign.widthM / sign.heightM).toBeCloseTo(w / h, 2);
      // Between the wall's columns (every 20 m from z = -120) unless mounted on their faces.
      if (sign.offsetM < 2.75) {
        const left = sign.z - sign.widthM / 2;
        const right = sign.z + sign.widthM / 2;
        const columns = Array.from({ length: 13 }, (_, i) => -120 + 20 * i);
        expect(
          columns.some((c) => c + 1.25 > left && c - 1.25 < right),
          sign.sprite,
        ).toBe(false);
      }
    }
  });
});
