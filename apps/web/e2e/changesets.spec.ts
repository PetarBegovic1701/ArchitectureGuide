import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 9 (Implementation.md §16, §13.8): change-set mode with its overlay and new
 * findings, tasks and the plan, applying to the baseline; generated views, drill-down,
 * breadcrumbs, scenarios, focus mode and the API view.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openStarter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
}

async function addNamed(page: Page, kind: string, name: string) {
  await page.getByTestId(`palette-item-${kind}`).click();
  const input = page.getByLabel('Element name');
  await input.fill(name);
  await input.press('Enter');
}

test('plan a feature in a change set, export the plan, and apply it', async ({ page }) => {
  await openStarter(page);
  await page.getByRole('button', { name: 'Change sets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change sets' });
  await dialog.getByLabel('Change set name').fill('Send receipts');
  await dialog.getByLabel('Change set description').fill('Email a receipt after checkout.');
  await dialog.getByRole('button', { name: 'Start change set' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  const banner = page.getByTestId('changeset-banner');
  await expect(banner).toContainText('Editing change set: Send receipts');
  await expect(banner).toContainText('0 new');

  // Edits go into the change set: a worker, shown as new; deleting the web app, as removed (with its arrows).
  // Clear the selection: an empty spot below the banner, away from the minimap.
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.getByTestId('canvas').click({ position: { x: box.width - 40, y: 70 } });
  await addNamed(page, 'node.service', 'Mailer');
  await expect(node(page, 'svc.mailer')).toBeVisible();
  await expect(page.getByTestId('diff-svc.mailer')).toHaveText('new');
  await node(page, 'app.web').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('diff-app.web')).toHaveText('removed');
  await expect(banner).toContainText('1 new');
  await expect(banner).toContainText('3 removed');

  // The Problems panel shows only what the change introduces.
  await expect(page.getByTestId('only-new-findings')).toBeChecked();

  // The baseline is untouched.
  await page.getByTestId('leave-changeset').click();
  await expect(banner).toHaveCount(0);
  await expect(node(page, 'svc.mailer')).toHaveCount(0);
  await expect(node(page, 'app.web')).toBeVisible();
  await expect(page.getByTestId('diff-app.web')).toHaveCount(0);

  // Back in: tasks, then the plan.
  await page.getByRole('button', { name: 'Change sets' }).click();
  await dialog.getByTestId('edit-changeset').click();
  await expect(banner).toBeVisible();
  await expect(node(page, 'svc.mailer')).toBeVisible();
  await banner.getByRole('button', { name: 'Tasks and details…' }).click();
  await dialog.getByRole('tab', { name: /Changes/ }).click();
  await expect(dialog).toContainText('svc.mailer (node.service)');
  await dialog.getByRole('tab', { name: /Tasks/ }).click();
  await dialog.getByTestId('generate-tasks').click();
  const tasks = dialog.getByTestId('tasks');
  await expect(tasks.getByLabel('Task title').first()).toHaveValue('Create svc.mailer');
  await expect(tasks.getByLabel('Task title').last()).toHaveValue('Remove app.web');
  await tasks.getByLabel('Done: Create svc.mailer').check();
  await dialog.getByRole('button', { name: 'Export plan…' }).click();
  const exporter = page.getByRole('dialog', { name: 'Export' });
  const preview = exporter.getByTestId('export-preview');
  await expect(preview).toContainText('# Plan: Send receipts');
  await expect(preview).toContainText('| ADD | svc.mailer (node.service) |');
  await expect(preview).toContainText('| REMOVE | app.web (react.app) |');
  await expect(preview).toContainText('1. **Create svc.mailer** (done)');
  await exporter.getByRole('option', { name: /^Kiro spec/ }).click();
  await exporter.getByLabel('File').selectOption({ label: '.kiro/specs/send-receipts/tasks.md' });
  await expect(preview).toContainText('- [x] 1. Create svc.mailer');
  await exporter.getByRole('button', { name: 'Close' }).click();

  // Undo works inside the change set, one step at a time.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(node(page, 'app.web')).toBeVisible();
  await expect(page.getByTestId('diff-app.web')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('diff-app.web')).toHaveText('removed');

  // Apply to the baseline: the edits are part of the model, the change set is done.
  await banner.getByRole('button', { name: 'Tasks and details…' }).click();
  await dialog.getByTestId('apply-changeset').click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Applied “Send receipts”' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(banner).toHaveCount(0);
  await expect(node(page, 'svc.mailer')).toBeVisible();
  await expect(node(page, 'app.web')).toHaveCount(0);
  await expect(page.getByTestId('diff-svc.mailer')).toHaveCount(0);

  // It is saved: a reload shows the applied model.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(node(page, 'svc.mailer')).toBeVisible();
});

test('views: context and containers, drill-down with breadcrumbs, focus mode', async ({ page }) => {
  await openStarter(page);
  const views = page.getByRole('button', { name: 'Views' });
  await views.click();
  await page.getByRole('menuitem', { name: 'Create context view' }).click();
  const crumbs = page.getByTestId('breadcrumbs');
  await expect(crumbs).toContainText('Context');
  await expect(node(page, 'svc.api')).toBeVisible();
  await expect(node(page, 'db.shop')).toHaveCount(0);

  await views.click();
  await page.getByRole('menuitem', { name: 'Create container view' }).click();
  await expect(crumbs).toContainText('Containers');
  await expect(node(page, 'db.shop')).toBeVisible();
  await expect(node(page, 'schema.public')).toHaveCount(0);

  // Drill into the database: its inside, with a way back.
  await node(page, 'db.shop').dblclick({ position: { x: 120, y: 60 } });
  await expect(crumbs).toContainText('Database: Shop DB');
  await expect(node(page, 'schema.public')).toBeVisible();
  await crumbs
    .getByRole('button', { name: /Main|Diagram|main/i })
    .first()
    .click();
  await expect(crumbs.locator('[aria-current="page"]')).not.toHaveText('Database: Shop DB');

  // Focus mode dims what is not connected to the selection.
  await node(page, 'actor.customer').click();
  await page.keyboard.press('f');
  await expect(page.getByTestId('focus-chip')).toBeVisible();
  await expect(node(page, 'actor.customer')).not.toHaveClass(/ag-dimmed/);
  await expect(node(page, 'app.web')).not.toHaveClass(/ag-dimmed/);
  await expect(node(page, 'db.shop')).toHaveClass(/ag-dimmed/);
  await page.getByTestId('focus-chip').getByRole('button', { name: '3' }).click();
  await expect(node(page, 'db.shop')).not.toHaveClass(/ag-dimmed/);
  await page.keyboard.press('f');
  await expect(page.getByTestId('focus-chip')).toHaveCount(0);

  // Filters dim what does not match; containers of a match stay.
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('dialog', { name: 'Filters' }).getByLabel('data').check();
  await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('filter-chip')).toContainText('layers data');
  await expect(node(page, 'db.shop')).not.toHaveClass(/ag-dimmed/);
  await expect(node(page, 'svc.api')).toHaveClass(/ag-dimmed/);
  await page.getByTestId('filter-chip').getByRole('button', { name: 'Clear filters' }).click();
  await expect(node(page, 'svc.api')).not.toHaveClass(/ag-dimmed/);
});

test('record a scenario, play it back and export it as a sequence diagram', async ({ page }) => {
  await openStarter(page);
  await page.getByRole('button', { name: 'Views' }).click();
  await page.getByRole('menuitem', { name: 'New scenario from this view' }).click();
  const bar = page.getByTestId('scenario-bar');
  await expect(bar.getByTestId('record-scenario')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('edge-label-rel.customer-uses-web').click();
  await page.getByTestId('edge-label-rel.web-calls-api').click();
  await page.getByTestId('edge-label-rel.api-writes-public').click();
  const steps = bar.getByTestId('scenario-steps');
  await expect(steps.locator('li')).toHaveCount(3);
  await expect(steps).toContainText('Web calls API');
  await bar.getByLabel('Note for step 3').fill('in one transaction');
  await bar.getByLabel('Note for step 3').press('Tab');

  await bar.getByTestId('play-scenario').click();
  await expect(steps.locator('li').first()).toHaveClass(/font-semibold/);
  await bar.getByTestId('next-step').click();
  await expect(steps.locator('li').nth(1)).toHaveClass(/font-semibold/);

  await bar.getByRole('button', { name: 'Sequence diagram' }).click();
  const preview = page.getByRole('dialog', { name: 'Export' }).getByTestId('export-preview');
  await expect(preview).toContainText('sequenceDiagram');
  await expect(preview).toContainText('actor actor__customer as Customer');
  await expect(preview).toContainText('app__web->>svc__api: calls');
  await expect(preview).toContainText('Note over svc__api,schema__public: in one transaction');
});

test('the API view lists endpoints and exports an OpenAPI skeleton', async ({ page }) => {
  await openStarter(page);
  await node(page, 'svc.api').click();
  await addNamed(page, 'node.route-handler', 'Orders');
  await expect(node(page, 'ctl.orders')).toBeVisible();
  await addNamed(page, 'node.endpoint', 'Create order');
  await page.getByRole('tab', { name: 'properties' }).click();
  const form = page.getByRole('form', { name: 'Element properties' });
  await form.getByLabel('Method').selectOption('POST');
  await form.getByLabel('Path', { exact: true }).fill('/orders');
  await form.getByLabel('Path', { exact: true }).press('Tab');

  await page.keyboard.press('Control+k');
  await page.getByLabel('Command', { exact: true }).fill('API view');
  await page.keyboard.press('Enter');
  const api = page.getByRole('dialog', { name: 'API view' });
  await expect(api.getByTestId('endpoints')).toContainText('POST');
  await expect(api.getByTestId('endpoints')).toContainText('/orders');
  await api.getByRole('button', { name: 'OpenAPI skeleton…' }).click();
  const preview = page.getByRole('dialog', { name: 'Export' }).getByTestId('export-preview');
  await expect(preview).toContainText('openapi: 3.1.0');
  await expect(preview).toContainText('/orders:');
});
