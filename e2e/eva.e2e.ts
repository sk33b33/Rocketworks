import { FLIGHT_SAVE_KEY } from '../src/persistence/flightSave';
import { SAVE_KEY } from '../src/persistence/saveGame';
import { crewOnMarsSave } from './flightFixture';
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

test('an astronaut walks out on Mars, collects nothing yet and climbs back aboard', async ({
  page,
}) => {
  await freshStart(page);
  await buildAndCertify(page);
  // A program with the plant running at Delta Hollow and the Mars Expedition committed.
  const save = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)) ?? '{}');
  const design = save.activeBlueprintId as string;
  const bp = (save.blueprints as { id: string; revision: number }[]).find((b) => b.id === design)!;
  save.progression.completedMissions = [
    'test-flight',
    'orbital-flight',
    'station-docking',
    'lunar-transfer',
    'lunar-landing',
    'mars-cargo',
  ];
  save.progression.calendarDay = 1_020;
  save.progression.marsBase = {
    siteId: 'delta-hollow',
    siteName: 'Delta Hollow',
    sinceDay: 505,
    ice: 0.6,
  };
  save.mission = {
    ...save.mission,
    missionId: 'mars-crewed',
    designId: design,
    crewIds: ['okafor', 'lindqvist'],
    payloadId: 'mars-supplies',
    refuel: { leo: true, depot: false },
    commit: { designId: design, revision: bp.revision, at: '2026-01-01T00:00:00.000Z' },
  };
  await seedOnNextLoad(page, SAVE_KEY, JSON.stringify(save));
  const fixture = crewOnMarsSave(1_020);
  await seedOnNextLoad(page, FLIGHT_SAVE_KEY, fixture.json);

  await expect(page.locator('.notice')).toContainText('Flight resumed');
  await expect(currentLocation(page)).toHaveText(/Mars/);
  expect(await clockTime(page)).toBe(fixture.clock);
  // The flight resumes paused: run the clock, then send someone outside.
  await page.getByRole('button', { name: /^Resume/ }).click();
  const eva = page.locator('[data-panel="eva"]');
  await expect(eva).toContainText('geology samples are marked');
  await eva.getByRole('button', { name: 'Start EVA' }).click();
  await expect(eva).toContainText('Suit oxygen');
  await expect(eva).toContainText(/Next sample/);
  await expect(page.locator('.flight-message')).toContainText('EVA');
  // Time warp is off while someone is outside.
  await expect(
    page.locator('[aria-label="Time warp"]').getByRole('button', { name: '100×' }),
  ).toBeDisabled();
  // Walking moves the astronaut away from the ship.
  const shipText = () => eva.locator('dd').nth(1).innerText();
  const before = await shipText();
  await page.keyboard.down('w');
  await expect.poll(shipText, { timeout: 15_000 }).not.toBe(before);
  await page.keyboard.up('w');
  // Close to the hatch: climb back aboard (no samples yet).
  const board = eva.getByRole('button', { name: 'Board the ship' });
  await page.keyboard.down('s');
  await expect(board).toBeEnabled({ timeout: 20_000 });
  await page.keyboard.up('s');
  await board.click();
  await expect(eva).toContainText('0 of 3 geology samples from this site are aboard');
  await expect(eva.getByRole('button', { name: 'Start EVA' })).toBeEnabled();
});
