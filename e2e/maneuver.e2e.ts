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

test('a manoeuvre node is planned, previewed, kept across a reload and armed', async ({ page }) => {
  await freshStart(page);
  await buildAndCertify(page);
  const save = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');
  save.progression.completedMissions = ['test-flight'];
  await seedOnNextLoad(page, SAVE_KEY, JSON.stringify(save));
  await commitMission(page, 'Low orbit', ['Mara Okafor', 'Tomas Lindqvist']);
  await seedOnNextLoad(page, FLIGHT_SAVE_KEY, orbitingFlightSave('orbital-flight').json);
  await expect(currentLocation(page)).toHaveText(/Flight/);

  const planner = page.locator('[data-panel="maneuver"]');
  await planner.getByRole('button', { name: 'In 10 min' }).click();
  await expect(planner).toContainText('Manoeuvre node');
  await expect(planner).toContainText('Give the node some Δv first.');
  await expect(planner.getByRole('button', { name: 'Execute node' })).toBeDisabled();
  const plus = planner
    .getByRole('group', { name: 'Prograde fine adjust' })
    .getByRole('button', { name: '+10' });
  for (let i = 0; i < 5; i++) await plus.click();
  await expect(planner).toContainText('Prograde 50.0 m/s');
  await expect(planner).toContainText('Δv50.0 m/s');
  // The orbit after the burn is higher on the far side.
  const after = await planner.locator('dd').nth(3).innerText();
  const now = await planner.locator('dd').nth(2).innerText();
  expect(parseInt(after, 10)).toBeGreaterThan(parseInt(now, 10));

  // The node is part of the flight save (the resumed flight is still paused).
  await page.reload();
  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(planner).toContainText('Prograde 50.0 m/s');

  await planner.getByRole('button', { name: 'Execute node' }).click();
  await expect(page.locator('.flight-message')).toContainText('Execute manoeuvre node engaged');
  await expect(planner.getByRole('button', { name: 'Stop the burn program' })).toBeVisible();
  await planner.getByRole('button', { name: 'Delete node' }).click();
  await expect(planner).toContainText('Manoeuvre planner');
});
