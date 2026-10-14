import { test as base, expect, type Page } from '@playwright/test';

/*
 * Shared helpers. Every test fails if the page logs a console error or throws, so "loads
 * without errors" is checked everywhere, not only in the navigation test.
 */

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await provide(errors);
      expect(errors, 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Fresh program: clear storage, reload and dismiss the first-run overview. */
export async function freshStart(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Start in the Factory' }).click();
  await expect(currentLocation(page)).toHaveText(/Rocket Factory/);
}

export const locationButton = (page: Page, name: string) =>
  page.locator('.locations').getByRole('button', { name: new RegExp('^(🔒 )?' + name) });

export const currentLocation = (page: Page) => page.locator('.locations [aria-current="location"]');

/** Factory: load the reference design, finish the assembly sequence and certify it. */
export async function buildAndCertify(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Designs' }).click();
  await page.getByRole('button', { name: 'Load reference design' }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const doIt = page.getByRole('button', { name: 'Do it for me' });
  for (let i = 0; i < 10 && (await doIt.count()) > 0; i++) await doIt.click();
  await page.getByRole('tab', { name: /Readiness/ }).click();
  await page.getByRole('button', { name: 'Certify for flight' }).click();
  await expect(page.locator('.notice')).toContainText(/certified/i);
}

/** Mission Control: pick a mission, crew it if needed, wait out bad weather and commit. */
export async function commitMission(
  page: Page,
  card: string,
  crew: readonly string[] = [],
): Promise<void> {
  await locationButton(page, 'Mission Control').click();
  await page.locator('.mission-card').filter({ hasText: card }).click();
  if (crew.length) {
    await page.getByRole('tab', { name: 'Manifest' }).click();
    for (const name of crew)
      await page.locator('.crew-list li').filter({ hasText: name }).getByRole('button').click();
  }
  await page.getByRole('tab', { name: /Readiness/ }).click();
  const weather = page.locator('.issue').filter({ hasText: 'Weather NO-GO' });
  for (let i = 0; i < 30 && (await weather.count()) > 0; i++)
    await weather.getByRole('button').click();
  await page.getByRole('button', { name: /Commit mission/ }).click();
  await expect(page.locator('.notice')).toContainText('GO for rollout');
}

/**
 * Put a raw value in localStorage just before the next page load, as if it had been saved by
 * an earlier session. (Writing it from the running page doesn't work: the game's own autosave
 * on page hide rewrites the key with the live state.) Applies once.
 */
export async function seedOnNextLoad(page: Page, key: string, value: string): Promise<void> {
  const flag = `e2e-seed:${key}:${Date.now()}`;
  await page.addInitScript(
    ([k, v, f]) => {
      if (sessionStorage.getItem(f!)) return;
      sessionStorage.setItem(f!, '1');
      localStorage.setItem(k!, v!);
    },
    [key, value, flag],
  );
  await page.reload();
}
