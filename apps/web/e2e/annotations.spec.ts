import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 4 (Implementation.md §15): sticky notes, regions, callouts and comments. */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function annotate(page: Page, item: string) {
  await page.getByRole('button', { name: 'Annotate' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('sticky notes, regions, callouts and comments on the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();

  // A sticky note is written right away.
  await annotate(page, 'Sticky note');
  const sticky = page.getByLabel('sticky text');
  await expect(sticky).toBeFocused();
  await sticky.fill('Ask the team about caching');
  await sticky.press('Control+Enter');
  await expect(page.locator('[data-testid^="sticky-"]')).toContainText(
    'Ask the team about caching',
  );

  // A region around the selected service.
  await node(page, 'svc.api').click();
  await annotate(page, 'Region (around the selection)');
  await page.getByLabel('region text').fill('Phase 2 scope');
  await page.getByLabel('region text').press('Control+Enter');
  await expect(page.locator('[data-testid^="region-"]')).toContainText('Phase 2 scope');
  // Shapes inside a region can still be clicked.
  await node(page, 'svc.api').click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('API');

  // A callout on the service, with a leader line.
  await annotate(page, 'Callout on the selection');
  await page.getByLabel('callout text').fill('Owns the orders schema');
  await page.getByLabel('callout text').press('Control+Enter');
  await expect(page.locator('[data-testid^="callout-"]')).toContainText('Owns the orders schema');

  // A comment thread on the service: write, reply, resolve.
  await node(page, 'svc.api').click();
  await annotate(page, 'Comment');
  const thread = page.getByRole('dialog', { name: 'Comment thread' });
  await expect(thread).toContainText('On API');
  await thread.getByLabel('comment text').fill('Should this be two services?');
  await thread.getByLabel('comment text').press('Control+Enter');
  await thread.getByLabel('Reply').fill('Not yet: one team.');
  await thread.getByLabel('Reply').press('Enter');
  await expect(thread).toContainText('Not yet: one team.');
  await page.screenshot({
    path: '/tmp/claude-0/-home-user-ArchitectureGuide/420d6321-9bfe-53a8-9051-79559af3ecec/scratchpad/annotations.png',
  });
  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.locator('[data-testid^="comment-"]')).toHaveCount(0);

  // Everything is one undo step each: undo the resolve brings the comment back.
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-testid^="comment-"]')).toHaveCount(1);
});
