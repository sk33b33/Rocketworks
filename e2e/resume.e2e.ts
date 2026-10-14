import { FLIGHT_SAVE_KEY } from '../src/persistence/flightSave';
import { SAVE_KEY } from '../src/persistence/saveGame';
import { orbitingFlightSave } from './flightFixture';
import {
  buildAndCertify,
  commitMission,
  currentLocation,
  expect,
  freshStart,
  seedOnNextLoad,
  test,
} from './fixtures';

const clock = (page: import('@playwright/test').Page) => page.locator('.mission-clock').first();
/** The T+ part of the clock, without the PAUSED/warp tags. */
const clockTime = async (page: import('@playwright/test').Page) =>
  ((await clock(page).innerText()).match(/T[+-][\d:]+/) ?? [''])[0];

test('a flight in orbit survives reloads and resumes paused at the same time', async ({ page }) => {
  await freshStart(page);
  await buildAndCertify(page);
  // Unlock the orbital mission as if the test flight had been flown.
  const save = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');
  save.progression.completedMissions = ['test-flight'];
  await seedOnNextLoad(page, SAVE_KEY, JSON.stringify(save));
  await commitMission(page, 'Low orbit', ['Mara Okafor', 'Tomas Lindqvist']);

  const fixture = orbitingFlightSave('orbital-flight');
  await seedOnNextLoad(page, FLIGHT_SAVE_KEY, fixture.json);

  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(currentLocation(page)).toHaveText(/Flight/);
  await expect(clock(page)).toContainText('PAUSED');
  expect(await clockTime(page)).toBe(fixture.clock);

  // Reloading while paused writes the same state back: nothing drifts.
  await page.reload();
  await expect(page.locator('.notice')).toContainText('Flight resumed');
  expect(await clockTime(page)).toBe(fixture.clock);

  // Fly on for a moment, pause, reload: the game's own autosave carries the new time.
  await page.getByRole('button', { name: /^Resume/ }).click();
  await page.locator('[aria-label="Time warp"]').getByRole('button', { name: '100×' }).click();
  await expect.poll(() => clockTime(page)).not.toBe(fixture.clock);
  await page.getByRole('button', { name: /^Pause/ }).click();
  await expect(clock(page)).toContainText('PAUSED');
  const later = await clockTime(page);
  await page.reload();
  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(currentLocation(page)).toHaveText(/Flight/);
  expect(await clockTime(page)).toBe(later);
});

test('a damaged flight save is discarded with a clear notice', async ({ page }) => {
  await freshStart(page);
  await seedOnNextLoad(page, FLIGHT_SAVE_KEY, '{not json');
  await expect(page.locator('.notice')).toContainText('could not be restored');
  expect(await page.evaluate((key) => localStorage.getItem(key), FLIGHT_SAVE_KEY)).toBeNull();
});
