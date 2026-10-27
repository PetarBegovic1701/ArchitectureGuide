import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Phase 2 acceptance (Implementation.md §26): findings show on the canvas and in the
 * Problems panel; a quick fix resolves one as a single undo step; "Why?" explains the
 * rule; a suppression needs a reason; rule packs can be turned off.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openStarter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();
}

test('a finding is shown, explained and fixed in one step', async ({ page }) => {
  await openStarter(page);
  const panel = page.getByTestId('problems-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('count-warning')).toHaveText('1');
  await expect(page.getByTestId('badge-svc.api')).toHaveAttribute('data-severity', 'warning');

  // Click the finding: the service is selected and its fixes show in the inspector too.
  const finding = panel.getByTestId('finding-RNP-016');
  await finding.getByRole('button', { name: /Public service without authentication/ }).click();
  await expect(node(page, 'svc.api')).toHaveClass(/selected/);
  await expect(
    page
      .getByRole('region', { name: 'Problems with the selection' })
      .getByTestId('finding-RNP-016'),
  ).toBeVisible();

  // "Why?" opens the rule's rationale in the Learn tab.
  await finding.getByRole('button', { name: 'Why?' }).click();
  await expect(page.getByTestId('learn-rule-RNP-016')).toContainText('anyone on the internet');

  // The quick fix adds an auth middleware inside the service and resolves the finding.
  await finding.getByRole('button', { name: 'Add an auth middleware' }).click();
  await expect(page.getByTestId('count-warning')).toHaveText('0');
  await expect(page.getByTestId('badge-svc.api')).toHaveCount(0);
  const middleware = page.locator('.react-flow__node[data-id^="mw."]');
  await expect(middleware).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: 'no longer reports it' })).toBeVisible();

  // One undo step removes the middleware and brings the finding back.
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect(middleware).toHaveCount(0);
  await expect(page.getByTestId('count-warning')).toHaveText('1');
});

test('suppressing needs a reason, and rule packs can be turned off', async ({ page }) => {
  await openStarter(page);
  const panel = page.getByTestId('problems-panel');
  await panel.getByTestId('finding-RNP-016').getByRole('button', { name: 'Suppress…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suppress finding' });
  const submit = dialog.getByRole('button', { name: 'Suppress' });
  await dialog.getByLabel('Reason').fill('too short');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Demo app, only runs on localhost.');
  await submit.click();
  await expect(page.getByTestId('count-warning')).toHaveText('0');
  await expect(page.getByTestId('no-problems')).toBeVisible();

  // Suppressed findings stay listed on request, with their reason.
  await panel.getByLabel(/Show suppressed/).check();
  await expect(panel.getByTestId('finding-RNP-016')).toContainText(
    'Demo app, only runs on localhost.',
  );
  await panel.getByRole('button', { name: 'Unsuppress' }).click();
  await expect(page.getByTestId('count-warning')).toHaveText('1');

  // Turning off the security pack removes its findings.
  await panel.getByRole('button', { name: 'Rules' }).click();
  await page
    .getByRole('group', { name: 'Rule packs' })
    .getByLabel(/^Security/)
    .uncheck();
  await expect(page.getByTestId('count-warning')).toHaveText('0');
});
