import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 3 (Implementation.md §13.3): automatic layout, and align for a selection. */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const box = async (page: Page, id: string) => (await node(page, id).boundingBox())!;

test('tidy up lays the diagram out as one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
  // Drop two shapes on top of each other.
  await page.getByTestId('palette-item-node.worker').click();
  await page.getByLabel('Element name').press('Enter');
  await page.getByTestId('palette-item-node.worker').click();
  await page.getByLabel('Element name').press('Enter');

  await page.getByRole('button', { name: 'Tidy up' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Tidied up.' })).toBeVisible();
  const ids = await page
    .locator('.react-flow__node')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-id')!).filter((id) => !id.startsWith('schema.')),
    );
  const boxes = await Promise.all(ids.map((id) => box(page, id)));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      const overlaps =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      // The database contains its schema; everything else stands apart.
      expect(overlaps, `${ids[i]} / ${ids[j]}`).toBe(false);
    }
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Tidied up.' })).toHaveCount(0);
});

test('resize a container by dragging its corner, as one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await node(page, 'db.shop').locator('.ag-container-header').click();
  const before = await box(page, 'db.shop');
  const schema = await box(page, 'schema.public');
  const corner = node(page, 'db.shop').locator('.react-flow__resize-control.bottom.right');
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 120, c.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await box(page, 'db.shop')).width)
    .toBeGreaterThan(before.width + 60);
  // The schema inside stays where it was.
  expect(await box(page, 'schema.public')).toEqual(schema);

  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(async () => (await box(page, 'db.shop')).width).toBeCloseTo(before.width, 0);
});

test('select several: Shift+click adds, Ctrl+click removes, then move and delete them', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await node(page, 'actor.customer').click();
  await node(page, 'app.web').click({ modifiers: ['Shift'] });
  await node(page, 'svc.api').click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 items selected.')).toBeVisible();
  // Shift+click on a selected shape keeps it; Ctrl+click removes it.
  await node(page, 'svc.api').click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 items selected.')).toBeVisible();
  await node(page, 'svc.api').click({ modifiers: ['Control'] });
  await expect(page.getByText('2 items selected.')).toBeVisible();

  // Dragging one moves both; the one left out stays.
  const customer = await box(page, 'actor.customer');
  const web = await box(page, 'app.web');
  const api = await box(page, 'svc.api');
  await page.mouse.move(web.x + web.width / 2, web.y + web.height / 2);
  await page.mouse.down();
  await page.mouse.move(web.x + web.width / 2 + 40, web.y + web.height / 2 + 160, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await box(page, 'app.web')).y).toBeGreaterThan(web.y + 100);
  const moved = (await box(page, 'actor.customer')).y - customer.y;
  expect(moved).toBeCloseTo((await box(page, 'app.web')).y - web.y, 0);
  expect(await box(page, 'svc.api')).toEqual(api);

  await page.keyboard.press('Delete');
  await expect(node(page, 'actor.customer')).toHaveCount(0);
  await expect(node(page, 'app.web')).toHaveCount(0);
  await expect(node(page, 'svc.api')).toBeVisible();
});

test('Alt+drag selects the shapes inside the box', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
  const ids = ['actor.customer', 'app.web'];
  const boxes = await Promise.all(ids.map((id) => box(page, id)));
  const left = Math.min(...boxes.map((b) => b.x)) - 16;
  const top = Math.min(...boxes.map((b) => b.y)) - 40;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 16;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 40;
  await page.keyboard.down('Alt');
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  for (const id of ids) await expect(node(page, id)).toHaveClass(/selected/);
  await expect(node(page, 'svc.api')).not.toHaveClass(/selected/);
  // The selection reached the store: Delete removes what the box selected.
  await page.keyboard.press('Delete');
  for (const id of ids) await expect(node(page, id)).toHaveCount(0);
  await expect(node(page, 'svc.api')).toBeVisible();
});

test('align the tops of selected shapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await node(page, 'actor.customer').click();
  await node(page, 'app.web').click({ modifiers: ['Shift'] });
  await node(page, 'svc.api').click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 items selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Align bottom' }).click();
  await expect
    .poll(async () => {
      const bottoms = await Promise.all(
        ['actor.customer', 'app.web', 'svc.api'].map(async (id) => {
          const b = await box(page, id);
          return Math.round(b.y + b.height);
        }),
      );
      return Math.max(...bottoms) - Math.min(...bottoms);
    })
    .toBeLessThanOrEqual(10);
});
