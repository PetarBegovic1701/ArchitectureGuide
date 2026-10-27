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

test('align the tops of selected shapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await node(page, 'actor.customer').click();
  await node(page, 'app.web').click({ modifiers: ['Control'] });
  await node(page, 'svc.api').click({ modifiers: ['Control'] });
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
