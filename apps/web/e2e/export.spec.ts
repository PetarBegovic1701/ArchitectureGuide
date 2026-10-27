import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 4 (Implementation.md §18, §17.8): the export dialog, and tours. */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openStarter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
}

test('export agent Markdown, a neighborhood, Mermaid and a PNG', async ({ page }) => {
  await openStarter(page);
  await page.keyboard.press('Control+e');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  const preview = dialog.getByTestId('export-preview');
  await expect(preview).toContainText('# Architecture: Starter');
  await expect(preview).toContainText('## Invariants');
  await expect(preview).toContainText('| app.web | calls | svc.api | http |');

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('ARCHITECTURE.md');

  await dialog.getByRole('option', { name: /^Mermaid/ }).click();
  await expect(preview).toContainText('flowchart LR');
  await dialog.getByRole('option', { name: /^PNG image/ }).click();
  await expect(dialog.getByRole('img', { name: 'The exported diagram' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Only the neighborhood of the selected database.
  await node(page, 'db.shop').locator('.ag-container-header').click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await dialog.getByLabel(/Only around Shop DB/).check();
  await expect(preview).toContainText('neighborhood of `db.shop`');
  await expect(preview).not.toContainText('| actor.customer |');
});

test('play a template tour, then draft and edit a tour', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'From a template…' }).click();
  await page.getByTestId('template-rnp.hexagonal-service').click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(node(page, 'dom.order')).toBeVisible();

  await page.getByRole('button', { name: 'Tours' }).click();
  await page.getByRole('menuitem', { name: /^Play: Tour: Hexagonal/ }).click();
  const player = page.getByTestId('tour-player');
  await expect(player).toContainText('Step 1 of 3');
  await expect(player).toContainText('The domain in the middle');
  await expect(node(page, 'dom.order').locator('.ag-halo')).toBeVisible();
  // Steps link the learning texts they talk about.
  await expect(player.getByText('Learn more:')).toBeVisible();
  await player.getByRole('button', { name: 'Next' }).click();
  await expect(player).toContainText('Ports and adapters');
  await player.getByRole('button', { name: 'Next' }).click();
  await player.getByRole('button', { name: 'Finish' }).click();
  await expect(player).toHaveCount(0);

  await page.getByRole('button', { name: 'Tours' }).click();
  await page.getByRole('menuitem', { name: 'Draft a tour from the diagram' }).click();
  const editor = page.getByRole('complementary', { name: 'Tour editor' });
  await expect(editor.getByTestId('tour-step-1')).toBeVisible();
  await editor.getByLabel('Tour title').fill('Welcome to Orders');
  await editor.getByLabel('Step 1 title').fill('Start here');
  await editor.getByRole('button', { name: 'Play' }).click();
  await expect(player).toContainText('Welcome to Orders');
  await expect(player).toContainText('Start here');
});
