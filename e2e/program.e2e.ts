import {
  buildAndCertify,
  commitMission,
  currentLocation,
  expect,
  freshStart,
  locationButton,
  test,
} from './fixtures';

test('build, certify and commit the first mission, kept across a reload', async ({ page }) => {
  await freshStart(page);
  await buildAndCertify(page);
  await commitMission(page, 'Uncrewed Test Flight');

  await page.getByRole('button', { name: 'Go to Launch Pad' }).click();
  await expect(currentLocation(page)).toHaveText(/Launch Pad/);

  // The plan is part of the saved program: after a reload it is still committed.
  await page.reload();
  await locationButton(page, 'Mission Control').click();
  await expect(page.locator('.committed')).toContainText('GO for rollout');
});
