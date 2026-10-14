import { currentLocation, expect, freshStart, locationButton, test } from './fixtures';

const LOCATIONS = [
  'Rocket Factory',
  'Mission Control',
  'Launch Pad',
  'Flight',
  'Orbital Station',
  'Moon',
] as const;

test('first run shows the program overview, then the Factory', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Start in the Factory');
  await page.getByRole('button', { name: 'Start in the Factory' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(currentLocation(page)).toHaveText(/Rocket Factory/);
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('every location opens or explains why it is locked', async ({ page }) => {
  await freshStart(page);
  for (const name of LOCATIONS) {
    const button = locationButton(page, name);
    const locked = (await button.getAttribute('aria-disabled')) === 'true';
    await button.click();
    if (locked) {
      // Still somewhere valid, and the reason is shown rather than failing silently.
      await expect(page.locator('.notice')).toBeVisible();
      continue;
    }
    await expect(currentLocation(page)).toHaveText(new RegExp(name));
    // Let the scene build and render a few frames so lazy errors surface.
    await page.waitForTimeout(1_000);
  }
});

test('settings persist across a reload', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Reduce motion').check();
  await page.getByLabel('125%').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('125%')).toBeChecked();
});
