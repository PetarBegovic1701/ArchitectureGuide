import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 5 on desktop (Implementation.md §13.10): the context menu and the C key. */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test('right-click menu and connect mode with the C key', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();

  // Right-click: duplicate the API, then delete the copy.
  await node(page, 'app.web').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Web' });
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(menu).toHaveCount(0);
  const shapes = page.locator('.react-flow__node-shape');
  const count = await shapes.count();
  await page.locator('.react-flow__node.selected').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(shapes).toHaveCount(count - 1);

  // Escape closes the menu.
  await node(page, 'app.web').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // C, then a refused pair: the database cannot call the React app.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('c');
  const banner = page.getByTestId('connect-banner');
  await expect(banner).toContainText('Tap the shape to connect from');
  await node(page, 'schema.public').click();
  await node(page, 'app.web').click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();

  // C with the customer selected starts at the customer; a second C cancels.
  const edges = page.locator('.react-flow__edge');
  await expect(edges).not.toHaveCount(0);
  const before = await edges.count();
  await node(page, 'actor.customer').click();
  await page.keyboard.press('c');
  await expect(banner).toContainText('From Customer');
  await page.keyboard.press('c');
  await expect(banner).toHaveCount(0);
  await page.keyboard.press('c');
  await node(page, 'svc.api').click();
  await expect(edges).toHaveCount(before + 1);
});
