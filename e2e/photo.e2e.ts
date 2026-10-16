import { currentLocation, expect, freshStart, test } from './fixtures';

test('photo mode hides the interface, saves a PNG and gives the interface back', async ({
  page,
}) => {
  await freshStart(page);
  await expect(currentLocation(page)).toContainText('Rocket Factory');
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Photo mode' });
  await expect(bar).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();

  // Orbit the camera a little, then take the picture.
  const layer = page.locator('.photo-layer');
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    bar.getByRole('button', { name: 'Take photo' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^rocketworks-factory-[\d-]+\.png$/);
  await expect(bar.getByRole('status')).toContainText('Saved rocketworks-factory-');

  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(page.locator('.topbar')).toBeVisible();
  // The P key opens it too.
  await page.keyboard.press('p');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('.topbar')).toBeVisible();
});
