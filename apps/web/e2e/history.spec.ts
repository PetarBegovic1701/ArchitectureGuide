import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 3 (Implementation.md §14.4, §14.1): snapshots with compare and restore, and
 * folder mode: a project saved to a folder reopens identically.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openStarter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
}

test('save a snapshot, compare the canvas with it, and restore it', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await openStarter(page);

  await page.getByRole('button', { name: 'Snapshots' }).click();
  const dialog = page.getByRole('dialog', { name: 'Snapshots' });
  await dialog.getByLabel('Snapshot name').fill('v1');
  await dialog.getByRole('button', { name: 'Save snapshot' }).click();
  await expect(dialog.getByTestId('snapshot-v1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Change the design: add a worker, remove the customer.
  await page.getByTestId('palette-item-node.worker').click();
  await page.getByLabel('Element name').fill('Mailer');
  await page.getByLabel('Element name').press('Enter');
  await expect(node(page, 'wrk.mailer')).toBeVisible();
  await node(page, 'actor.customer').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'actor.customer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Snapshots' }).click();
  await dialog.getByTestId('snapshot-v1').getByRole('button', { name: 'Compare' }).click();
  const banner = page.getByTestId('compare-banner');
  await expect(banner).toContainText('1 new');
  await expect(banner).toContainText('2 removed');
  await expect(banner).toContainText('Removed: Customer');
  await expect(page.getByTestId('diff-wrk.mailer')).toHaveText('new');

  await page.getByRole('button', { name: 'Snapshots' }).click();
  await dialog.getByTestId('snapshot-v1').getByRole('button', { name: 'Restore' }).click();
  await expect(node(page, 'actor.customer')).toBeVisible();
  await expect(node(page, 'wrk.mailer')).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  // The state before the restore was kept as a snapshot.
  await page.getByRole('button', { name: 'Snapshots' }).click();
  await expect(dialog.getByTestId('snapshot-Before restoring “v1”')).toBeVisible();
});

test('a project saved to a folder reopens identically', async ({ page }) => {
  // The browser's private file system stands in for a folder the user picks.
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
      async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('repo', { create: true });
  });
  const readFile = () =>
    page.evaluate(async () => {
      const repo = await (await navigator.storage.getDirectory()).getDirectoryHandle('repo');
      return (await (await repo.getFileHandle('starter.archguide.json')).getFile()).text();
    });

  await openStarter(page);
  await page.getByRole('link', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await expect(page.getByRole('heading', { name: 'Folder: repo' })).toBeVisible();
  await page.getByRole('button', { name: 'Save to folder' }).click();
  const folderSection = page.getByRole('region', { name: 'Folder' });
  await expect(folderSection.getByText('starter.archguide.json')).toBeVisible();

  // Edit the project; autosave writes the file.
  await folderSection.getByRole('button', { name: /Starter/ }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
  await page.getByLabel('Project name').fill('Shop architecture');
  await page.getByLabel('Project name').press('Enter');
  await expect(page.getByTestId('save-status')).toHaveText('Saved to folder repo');
  const saved = await readFile();
  expect(JSON.parse(saved).name).toBe('Shop architecture');

  // A new session: open the folder again, then the project.
  await page.reload();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open folder…' }).click();
  await folderSection.getByRole('button', { name: 'Shop architecture' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Shop architecture');
  await expect(page.getByTestId('save-status')).toHaveText('Saved to folder repo');
  expect(await readFile()).toBe(saved);
});
