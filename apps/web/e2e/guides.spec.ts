import { expect, test } from '@playwright/test';

/**
 * Concept guides (Implementation.md §13.11): picking a shape explains what it is for, where
 * it is used in real projects, and what it connects to; "+" adds and connects the other shape.
 */

test('build a Redux flow from the guides: store, action, effect, API client', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name').fill('Shop');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByTestId('palette-item-react.app').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Full' }).click();

  // Pick the store: the guide explains it right away.
  await page.getByTestId('palette-item-react.client-store').click();
  await page.keyboard.press('Escape');
  const guide = page.getByTestId('concept-guide');
  await expect(guide).toContainText('About: Client state store');
  await expect(guide).toContainText('A Redux store holds the cart');
  await expect(guide.getByTestId('guide-link-in-updates-react.action')).toContainText(
    'Actions are the only way the state changes',
  );

  const nodes = page.locator('.react-flow__node-shape');
  const edges = page.locator('.react-flow__edge');
  await expect(nodes).toHaveCount(2);

  // "+" adds an action inside the React app and connects it; the store stays selected.
  await guide.getByRole('button', { name: 'Add Action / thunk (it updates this)' }).click();
  await expect(nodes).toHaveCount(3);
  await expect(edges).toHaveCount(1);
  await expect(guide.getByTestId('guide-link-in-updates-react.action')).toContainText(
    'Connected: Action / thunk',
  );
  const action = page.locator('.react-flow__node[data-id^="act."]');
  await expect(action).toBeVisible();

  // From the action: the effect that dispatches it, and the API client a thunk calls.
  await action.click();
  await expect(guide).toContainText('About: Action / thunk');
  await guide.getByRole('button', { name: 'Add Effect (useEffect) (it dispatches this)' }).click();
  await guide.getByRole('button', { name: 'Add API client (this fetches via it)' }).click();
  await expect(nodes).toHaveCount(5);
  await expect(edges).toHaveCount(3);

  // Each "+" is one undo step.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(nodes).toHaveCount(4);
  await expect(edges).toHaveCount(2);

  // A shape that already exists can be connected instead of adding a new one.
  await page.locator('.react-flow__node[data-id^="eff."]').click();
  await expect(guide).toContainText('About: Effect (useEffect)');
  await guide.getByRole('button', { name: /^Add or connect Client state store/ }).click();
  await page.getByRole('menuitem', { name: 'Connect Client state store' }).click();
  await expect(nodes).toHaveCount(4);
  await expect(edges).toHaveCount(3);
});

test('the palette explains a shape without adding it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(page.locator('.react-flow__node[data-id="svc.api"]')).toBeVisible();
  const nodes = page.locator('.react-flow__node-shape');
  const count = await nodes.count();

  await page.getByRole('button', { name: 'About Node service' }).click();
  await expect(page.getByRole('tab', { name: 'Learn' })).toHaveAttribute('aria-selected', 'true');
  const learn = page.getByTestId('guide-node.service');
  await expect(learn).toContainText('An Express API');
  await expect(learn).toContainText('One service owns the migrations of a schema.');
  await expect(nodes).toHaveCount(count);

  // Without a selected shape there is nothing to add to; partner names open their guide.
  await expect(learn.getByRole('button', { name: /^Add / })).toHaveCount(0);
  await learn.getByRole('button', { name: 'Job queue', exact: false }).first().click();
  await expect(page.getByTestId('guide-pg.job-queue')).toContainText('pg-boss queues');

  // Everything else the rules allow, for the curious.
  await page.getByRole('button', { name: 'About Node service' }).click();
  await learn.getByText('Everything else the rules allow').click();
  await expect(learn.getByText(/^It calls:/)).toBeVisible();
});
