import { FLIGHT_SAVE_KEY } from '../src/persistence/flightSave';
import { SAVE_KEY } from '../src/persistence/saveGame';
import { cruisingMarsSave } from './flightFixture';
import {
  buildAndCertify,
  currentLocation,
  expect,
  freshStart,
  seedOnNextLoad,
  test,
} from './fixtures';

const clockTime = async (page: import('@playwright/test').Page) =>
  ((await page.locator('.mission-clock').first().innerText()).match(/T[+-][\dd: ]+\d/) ?? [''])[0];

test('a Mars cruise survives reloads and resumes paused at the Mars location', async ({ page }) => {
  await freshStart(page);
  await buildAndCertify(page);
  // A program that has flown the Moon missions, inside a Mars window, with the cargo flight committed.
  const save = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');
  const design = save.activeBlueprintId as string;
  const bp = (save.blueprints as { id: string; revision: number }[]).find((b) => b.id === design)!;
  save.progression.completedMissions = [
    'test-flight',
    'orbital-flight',
    'station-docking',
    'lunar-transfer',
    'lunar-landing',
  ];
  save.progression.calendarDay = 245;
  save.mission = {
    ...save.mission,
    missionId: 'mars-cargo',
    designId: design,
    crewIds: [],
    payloadId: 'mars-plant',
    refuel: { leo: true, depot: false },
    commit: { designId: design, revision: bp.revision, at: '2026-01-01T00:00:00.000Z' },
  };
  await seedOnNextLoad(page, SAVE_KEY, JSON.stringify(save));
  const fixture = cruisingMarsSave(245);
  await seedOnNextLoad(page, FLIGHT_SAVE_KEY, fixture.json);

  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(currentLocation(page)).toHaveText(/Mars/);
  await expect(page.locator('.mission-clock').first()).toContainText('PAUSED');
  expect(await clockTime(page)).toBe(fixture.clock);
  await expect(page.locator('[data-panel="mars"]')).toContainText('Cruising to Mars');
  await expect(page.getByLabel('Map legend')).toBeVisible();

  // Pick a site and fly on for a moment at deep-space warp; the autosave carries it over.
  await page
    .locator('.zone-option')
    .filter({ hasText: 'Redstone Plateau' })
    .locator('input')
    .check();
  await page.getByRole('button', { name: /^Resume/ }).click();
  await page.locator('[aria-label="Time warp"]').getByRole('button', { name: '100k×' }).click();
  await expect.poll(() => clockTime(page)).not.toBe(fixture.clock);
  await page.getByRole('button', { name: /^Pause/ }).click();
  const later = await clockTime(page);
  await page.reload();
  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(currentLocation(page)).toHaveText(/Mars/);
  expect(await clockTime(page)).toBe(later);
  await expect(page.locator('[data-panel="mars"]')).toContainText('Redstone Plateau');
});
