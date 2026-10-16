import { expect, freshStart, test } from './fixtures';

test('sound settings work and persist, and audio starts without errors', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const volume = page.getByLabel('Sound volume');
  await expect(volume).toHaveValue('0.6');
  await volume.fill('0.25');
  await page.getByLabel('Mute').check();
  await expect(volume).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Sound volume')).toHaveValue('0.25');
  await expect(page.getByLabel('Mute')).toBeChecked();
  await page.getByLabel('Mute').uncheck();
  await expect(page.getByLabel('Sound volume')).toBeEnabled();
});
