import { SAVE_KEY } from '../src/persistence/saveGame';
import { buildAndCertify, expect, freshStart, seedOnNextLoad, test } from './fixtures';

test('a contract accepted from the board is planned, kept across a reload and can be cancelled', async ({
  page,
}) => {
  await freshStart(page);
  await buildAndCertify(page);
  // A program that has flown the crewed shakedown: satellite contracts are on offer.
  const save = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');
  save.progression.completedMissions = ['test-flight', 'orbital-flight'];
  save.progression.calendarDay = 40;
  await seedOnNextLoad(page, SAVE_KEY, JSON.stringify(save));

  await page
    .locator('.locations')
    .getByRole('button', { name: /^Mission Control/ })
    .click();
  await page.getByRole('button', { name: 'Contracts', exact: true }).click();
  const board = page.locator('.contract-board');
  await expect(board).toContainText('400,000 cr');
  const offer = board.locator('li.contract-card').filter({ hasText: 'satellite' }).first();
  const title = (await offer.locator('strong').first().innerText()).trim();
  await offer.getByRole('button', { name: 'Accept' }).click();
  await expect(page.locator('.notice')).toContainText('Contract accepted');
  const active = board.locator('.contract-card.active');
  await expect(active).toContainText(title);
  // Mission Control is set up for the flight, with the client's pay shown against the cost.
  await expect(page.locator('.recovery-section')).toContainText('Contract pays');

  await page.reload();
  await page
    .locator('.locations')
    .getByRole('button', { name: /^Mission Control/ })
    .click();
  await expect(page.locator('.contract-board .contract-card.active')).toContainText(title);

  await page.getByRole('button', { name: 'Cancel contract' }).click();
  await expect(page.locator('.notice')).toContainText('Contract cancelled');
  await expect(page.locator('.contract-board')).toContainText('16 / 100');
  await expect(page.locator('.contract-board .contract-card.active')).toHaveCount(0);
});
