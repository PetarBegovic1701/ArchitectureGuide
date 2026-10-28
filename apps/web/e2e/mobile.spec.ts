import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Phase 5 (Implementation.md §13.10): on a phone and a tablet, with touch only, a user
 * opens the starter, follows its tour, fixes a finding, connects two shapes and renames
 * one, and the page never scrolls sideways.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const isPhone = (page: Page) => page.viewportSize()!.width < 640;

async function noSidewaysScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
}

/** A touch held still for 600 ms (Playwright's touchscreen only taps). */
async function longPress(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The "More" menu on the top bar holds what the desktop top bar shows. */
async function more(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('menuitem', { name: item }).tap();
}

test('starter, tour, quick fix, connect and rename with touch', async ({ page }) => {
  await page.goto('/');
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: 'Open the starter' }).tap();
  await expect(node(page, 'svc.api')).toBeVisible();
  await noSidewaysScroll(page);
  const toolbar = page.getByRole('navigation', { name: 'Toolbar' });
  await expect(toolbar).toHaveCount(isPhone(page) ? 1 : 0);

  // Follow the starter's tour to the end.
  await more(page, /^Play tour: How a request travels/);
  const player = page.getByTestId('tour-player');
  await expect(player).toContainText('Step 1 of 3');
  await player.getByRole('button', { name: 'Next' }).tap();
  await expect(player).toContainText('The API');
  await player.getByRole('button', { name: 'Next' }).tap();
  await player.getByRole('button', { name: 'Finish' }).tap();
  await expect(player).toHaveCount(0);

  // Fix the finding from the Problems sheet (phone) or panel (tablet).
  if (isPhone(page)) {
    await expect(page.getByTestId('toolbar-problem-count')).toHaveText('1');
    await toolbar.getByRole('button', { name: /Problems/ }).tap();
    await expect(page.getByTestId('bottom-sheet')).toBeVisible();
  }
  await page
    .getByTestId('finding-RNP-016')
    .getByRole('button', { name: 'Add an auth middleware' })
    .tap();
  await expect(page.locator('.react-flow__node[data-id^="mw."]')).toHaveCount(1);
  if (isPhone(page)) {
    await expect(page.getByTestId('toolbar-problem-count')).toHaveCount(0);
    // Tapping the empty canvas closes the sheet.
    await page.locator('.react-flow__pane').tap({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId('bottom-sheet')).toHaveCount(0);
  }

  // Add a worker from the palette sheet or drawer: it lands in the visible center.
  if (isPhone(page)) await toolbar.getByRole('button', { name: 'Add' }).tap();
  else await page.getByRole('button', { name: 'Shapes' }).tap();
  await page.getByTestId('palette-item-node.worker').tap();
  const worker = page
    .locator('.react-flow__node[data-id^="worker."], .react-flow__node[data-id*="worker"]')
    .first();
  await expect(worker).toBeVisible();
  if (!isPhone(page)) await page.keyboard.press('Escape');
  const workerId = (await worker.getAttribute('data-id'))!;

  // Connect mode: tap Connect, the worker, then the API.
  const edges = page.locator('.react-flow__edge');
  await expect(edges).not.toHaveCount(0); // React Flow may still be rendering them
  const before = await edges.count();
  if (isPhone(page)) await toolbar.getByRole('button', { name: 'Connect' }).tap();
  else {
    await longPress(page, worker);
    await page.getByRole('menuitem', { name: 'Connect from here' }).tap();
  }
  const banner = page.getByTestId('connect-banner');
  await expect(banner).toBeVisible();
  if (isPhone(page)) {
    await worker.tap();
    await expect(banner).toContainText('tap the shape to connect to');
  }
  await page.locator('.react-flow__controls-fitview').tap();
  // The quick fix made the API a container: its header is the tap target.
  await node(page, 'svc.api').locator('.ag-container-header').tap();
  await expect(banner).toHaveCount(0);
  await expect(edges).toHaveCount(before + 1);

  // Long-press the worker: rename it from the context menu.
  await longPress(page, page.locator(`.react-flow__node[data-id="${workerId}"]`));
  const menu = page.getByRole('menu', { name: /Actions for/ });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Rename' }).tap();
  const name = page.getByLabel('Element name');
  await name.fill('Email sender');
  await name.press('Enter');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Email sender' })).toBeVisible();
  await noSidewaysScroll(page);
});

test('dialogs and panels fit the screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).tap();
  await expect(node(page, 'svc.api')).toBeVisible();

  for (const [item, dialog] of [
    ['Templates…', 'Insert a template'],
    ['Snapshots…', 'Snapshots'],
    ['Export…', 'Export'],
  ] as const) {
    await more(page, item);
    const box = (await page.getByRole('dialog', { name: dialog }).boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await noSidewaysScroll(page);
    await page
      .getByRole('dialog', { name: dialog })
      .getByRole('button', { name: 'Close', exact: true })
      .tap();
    await expect(page.getByRole('dialog', { name: dialog })).toHaveCount(0);
  }

  // The Learn tab for a tapped shape.
  await node(page, 'app.web').tap();
  if (isPhone(page))
    await page
      .getByRole('navigation', { name: 'Toolbar' })
      .getByRole('button', { name: 'Learn' })
      .tap();
  else {
    await page.getByRole('button', { name: 'Inspector' }).tap();
    await page.getByRole('tab', { name: 'Learn' }).tap();
  }
  await expect(page.getByRole('dialog', { name: 'Inspector' })).toContainText(/React/);
  await noSidewaysScroll(page);

  // The palette's info button opens the shape's guide in the sheet or drawer.
  if (isPhone(page))
    await page
      .getByRole('navigation', { name: 'Toolbar' })
      .getByRole('button', { name: 'Add' })
      .tap();
  else await page.getByRole('button', { name: 'Shapes' }).tap();
  await page.getByRole('button', { name: 'About Node service' }).tap();
  await expect(
    page.getByRole('dialog', { name: 'Inspector' }).getByTestId('guide-node.service'),
  ).toContainText('An Express API');
  await noSidewaysScroll(page);
});
