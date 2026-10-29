import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 3 (Implementation.md §12, §26): new project from a template with parameters,
 * a template inserted into a canvas as one undo step, and a selection saved as a template.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test('a new project from the hexagonal template uses the parameters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'From a template…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project from a template' });
  await dialog.getByTestId('template-rnp.hexagonal-service').click();
  await expect(dialog).toContainText('Hexagonal Node service');
  await dialog.getByLabel('Aggregate').fill('Invoice');
  await expect(dialog).toContainText('Persistence MUST go through a node.port');
  await dialog.getByLabel('Project name').fill('Billing');
  await dialog.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/#\/p\/billing/);
  await expect(node(page, 'dom.invoice')).toBeVisible();
  await expect(node(page, 'port.invoice-repository-port')).toBeVisible();
  // A template is an example of good design: no problems.
  await expect(page.getByTestId('count-warning')).toHaveText('0');
  await expect(page.getByTestId('count-error')).toHaveText('0');
});

test('a template is inserted into the canvas as one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();

  await page.getByRole('button', { name: 'Templates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert a template' });
  await dialog.getByTestId('template-rnp.background-jobs').click();
  await dialog.getByLabel('Jobs (comma-separated)').fill('Send receipt, Send receipt');
  await expect(dialog.getByText('must be different')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled();
  await dialog.getByLabel('Jobs (comma-separated)').fill('Send receipt, Export report');
  await dialog.getByRole('button', { name: 'Insert' }).click();

  await expect(node(page, 'wrk.worker')).toBeVisible();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Inserted Background jobs on PostgreSQL' }),
  ).toBeVisible();
  // The starter's own nodes are still there, and the new ones do not cover them.
  await expect(node(page, 'svc.api')).toBeVisible();

  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect(node(page, 'wrk.worker')).toHaveCount(0);
  await expect(node(page, 'svc.api')).toBeVisible();
});

test('a selection saved as a template can be inserted again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await node(page, 'svc.api').click();
  // A container is selected by its header; Shift adds to the selection.
  await node(page, 'db.shop')
    .locator('.ag-container-header')
    .click({ modifiers: ['Shift'] });

  await page.keyboard.press('Control+k');
  await page.getByLabel('Command', { exact: true }).fill('save selection');
  await page.keyboard.press('Enter');
  const save = page.getByRole('dialog', { name: 'Save selection as template' });
  await save.getByLabel('Name').fill('API with database');
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'API with database' })).toBeVisible();

  await page.getByRole('button', { name: 'Templates' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert a template' });
  await dialog.getByTestId('template-custom.api-with-database').click();
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(node(page, 'svc.api-2')).toBeVisible();
  await expect(node(page, 'schema.public-2')).toBeVisible();
});
