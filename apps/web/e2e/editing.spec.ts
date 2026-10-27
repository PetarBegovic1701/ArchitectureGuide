import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openStarter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
}

test('edit relation settings in the inspector and learn at different levels', async ({ page }) => {
  await openStarter(page);
  await page.getByTestId('edge-label-rel.api-writes-public').click();
  const form = page.getByRole('form', { name: 'Relation properties' });
  await expect(form).toContainText('API writes public');
  await form.getByLabel('Concurrency control').selectOption('row-lock');
  await expect(form.getByLabel('Concurrency control')).toHaveValue('row-lock');

  await page.getByRole('tab', { name: 'learn' }).click();
  await page
    .getByRole('button', { name: 'Concurrency control (lost updates, locks, versions)' })
    .click();
  const text = page.getByTestId('learn-topic.concurrency-control');
  const levels = page.getByRole('group', { name: 'Experience level' });
  await levels.getByRole('button', { name: 'beginner' }).click();
  await expect(text).toContainText('race condition');
  await expect(text).not.toContainText('References');
  await levels.getByRole('button', { name: 'senior' }).click();
  await expect(text).toContainText('SKIP LOCKED');
  await expect(text).toContainText('References');

  // Undo restores the previous property value.
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+z');
  await page.getByTestId('edge-label-rel.api-writes-public').click();
  await page.getByRole('tab', { name: 'properties' }).click();
  await expect(
    page.getByRole('form', { name: 'Relation properties' }).getByLabel('Concurrency control'),
  ).toHaveValue('');
});

test('drag a schema into another database, duplicate, delete and undo', async ({ page }) => {
  await openStarter(page);

  // A second database next to the first, then move the schema into it by dragging.
  await node(page, 'db.shop').click({ position: { x: 30, y: 12 } });
  await page.getByTestId('palette-item-pg.database').click();
  const name = page.getByLabel('Element name');
  await name.fill('Analytics');
  await name.press('Enter');
  await expect(node(page, 'db.analytics')).toBeVisible();
  const target = (await node(page, 'db.analytics').boundingBox())!;
  const schema = (await node(page, 'schema.public').boundingBox())!;
  await page.mouse.move(schema.x + schema.width / 2, schema.y + schema.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await node(page, 'schema.public').click();
  await page.getByRole('tab', { name: 'properties' }).click();
  // The schema now lives inside the analytics database: the Analytics frame encloses it.
  const frame = (await node(page, 'db.analytics').boundingBox())!;
  const moved = (await node(page, 'schema.public').boundingBox())!;
  expect(moved.x).toBeGreaterThan(frame.x);
  expect(moved.x + moved.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

  // Duplicate the API, then delete the copy and undo the delete.
  await node(page, 'svc.api').click();
  await page.keyboard.press('Control+d');
  await expect(node(page, 'svc.api-2')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(node(page, 'svc.api-2')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(node(page, 'svc.api-2')).toBeVisible();
});

test('the command palette adds shapes and jumps to elements', async ({ page }) => {
  await openStarter(page);
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+k');
  const command = page.getByLabel('Command', { exact: true });
  await command.fill('add background worker');
  await command.press('Enter');
  const name = page.getByLabel('Element name');
  await expect(name).toBeFocused();
  await name.fill('Mailer');
  await name.press('Enter');
  await expect(node(page, 'wrk.mailer')).toBeVisible();

  await page.keyboard.press('Control+k');
  await command.fill('go to shop db');
  await command.press('Enter');
  await expect(
    page.getByRole('form', { name: 'Element properties' }).getByLabel('Name'),
  ).toHaveValue('Shop DB');
});
