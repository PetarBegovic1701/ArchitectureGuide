import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 1 acceptance (Implementation.md §26): a user builds the starter architecture
 * (React app → Node API → PostgreSQL) from scratch in under two minutes, and a refused
 * relation shows a message, a working fix and a "Why?" explanation.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function addFromPalette(page: Page, kind: string, name: string) {
  await page.getByTestId(`palette-item-${kind}`).click();
  const input = page.getByLabel('Element name');
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press('Enter');
}

/**
 * Waits until a shape is fully inside the canvas and has stopped moving: adding a shape
 * pans the canvas to reveal it, a moment later.
 */
async function settled(page: Page, id: string) {
  let last = '';
  await expect
    .poll(
      async () => {
        const box = await node(page, id).boundingBox();
        const canvas = await page.getByTestId('canvas').boundingBox();
        const key = JSON.stringify(box);
        const still = key === last;
        last = key;
        return (
          still &&
          !!box &&
          !!canvas &&
          box.x >= canvas.x &&
          box.y >= canvas.y &&
          box.x + box.width <= canvas.x + canvas.width &&
          box.y + box.height <= canvas.y + canvas.height
        );
      },
      { intervals: [150] },
    )
    .toBe(true);
}

/** Drags from the source's right handle to the middle of the target shape. */
async function connect(page: Page, sourceId: string, targetId: string) {
  await settled(page, sourceId);
  await settled(page, targetId);
  await node(page, sourceId).hover();
  const handle = await node(page, sourceId).locator('.react-flow__handle-right').boundingBox();
  const target = await node(page, targetId).boundingBox();
  if (!handle || !target) throw new Error('missing handle or target');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('build the starter architecture and learn from a refused connection', async ({ page }) => {
  const started = Date.now();
  await page.goto('/');
  await page.getByLabel('Name').fill('Shop');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/#\/p\/shop/);

  // Frontend and backend, connected with the only valid type: calls.
  await addFromPalette(page, 'react.app', 'Web');
  await expect(node(page, 'app.web')).toBeVisible();
  await addFromPalette(page, 'node.service', 'API');
  await expect(node(page, 'svc.api')).toBeVisible();
  await connect(page, 'app.web', 'svc.api');
  await expect(page.getByTestId('edge-label-rel.app-web-calls-svc-api')).toHaveText('calls');

  // A schema cannot stand alone: it goes inside a database.
  await addFromPalette(page, 'pg.database', 'Shop DB');
  await node(page, 'db.shop-db').click();
  await addFromPalette(page, 'pg.schema', 'public');
  await expect(node(page, 'schema.public')).toBeVisible();

  // Wrong direction: the database does not call the service. The fix reverses it.
  await connect(page, 'schema.public', 'svc.api');
  const reverse = page
    .getByTestId('toast')
    .filter({ hasText: 'PostgreSQL does not call services' });
  await expect(reverse).toBeVisible();
  await reverse.getByRole('button', { name: 'Reverse it' }).click();
  await expect(page.getByTestId('edge-label-rel.svc-api-reads-schema-public')).toHaveText('reads');

  // Several types are valid: the picker asks which one.
  await connect(page, 'svc.api', 'schema.public');
  await expect(page.getByTestId('relation-picker')).toBeVisible();
  await page.getByTestId('pick-writes').click();
  await expect(page.getByTestId('edge-label-rel.svc-api-writes-schema-public')).toHaveText(
    'writes',
  );

  // Browser → database is refused, and "Why?" explains it in the Learn tab.
  await connect(page, 'app.web', 'schema.public');
  const refusal = page
    .getByTestId('toast')
    .filter({ hasText: 'Browser code cannot connect to PostgreSQL' });
  await expect(refusal).toBeVisible();
  await refusal.getByRole('button', { name: 'Why?' }).click();
  await expect(page.getByTestId('learn-refusal')).toContainText(
    'Browser code cannot connect to PostgreSQL',
  );
  await expect(page.getByTestId('learn-react.app')).toBeVisible();

  // Undo and redo the last relation.
  await page.getByTestId('canvas').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('edge-label-rel.svc-api-writes-schema-public')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('edge-label-rel.svc-api-writes-schema-public')).toHaveCount(1);

  expect(Date.now() - started).toBeLessThan(120_000);

  // Everything is saved in the browser and comes back after a reload.
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await page.reload();
  for (const id of ['app.web', 'svc.api', 'db.shop-db', 'schema.public'])
    await expect(node(page, id)).toBeVisible();
  await expect(page.getByTestId('edge-label-rel.svc-api-writes-schema-public')).toHaveCount(1);
});

test('a module cannot be placed on its own, and the message says where it can go', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Name').fill('Nesting');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('palette-item-node.module').click();
  await expect(page.getByTestId('toast')).toContainText('must be placed inside');
});

test('drag a shape from the palette onto the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name').fill('Drag');
  await page.getByRole('button', { name: 'Create' }).click();
  await page
    .getByTestId('palette-item-gen.actor')
    .dragTo(page.getByTestId('canvas'), { targetPosition: { x: 300, y: 300 } });
  const input = page.getByLabel('Element name');
  await expect(input).toBeFocused();
  await input.fill('Customer');
  await input.press('Enter');
  await expect(node(page, 'actor.customer')).toBeVisible();
});
