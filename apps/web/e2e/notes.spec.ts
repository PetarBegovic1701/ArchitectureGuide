import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 4 (Implementation.md §15): project notes with @ mentions, glossary, decisions. */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test('notes with mentions, and a decision linked to a shape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await expect(node(page, 'svc.api')).toBeVisible();

  // A note that mentions the API through the @ picker.
  await page.getByRole('tab', { name: 'notes' }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByLabel('Note title').fill('Release plan');
  const text = page.getByLabel('Note text');
  await text.fill('The first release ships ');
  await text.pressSequentially('@ap');
  await expect(page.getByRole('listbox', { name: 'Mention an element' })).toContainText('API');
  await text.press('Enter');
  await expect(text).toHaveValue('The first release ships @svc.api ');
  await page.getByRole('button', { name: 'Save' }).click();
  const editor = page.getByTestId('note-editor');
  await editor.getByRole('button', { name: '@API' }).click();
  await expect(node(page, 'svc.api')).toHaveClass(/selected/);

  // A glossary note from the template.
  await page.getByRole('tab', { name: 'notes' }).click();
  await editor.getByRole('button', { name: 'All notes' }).click();
  await page.getByRole('button', { name: 'Add a glossary' }).click();
  await expect(page.getByLabel('Note title')).toHaveValue('Glossary');
  await page.getByRole('button', { name: 'Save' }).click();

  // A decision linked to the selected API shows a badge on it.
  await node(page, 'svc.api').click();
  await page.getByRole('tab', { name: 'decisions' }).click();
  await page.getByRole('button', { name: /New decision \(linked to 1 selected\)/ }).click();
  await page.getByLabel('Decision title').fill('One API for now');
  await page.getByLabel('Decision status').selectOption('accepted');
  await page
    .getByLabel('Decision', { exact: true })
    .fill('Keep a single Node API until a second team joins.');
  await page.getByRole('button', { name: 'Save' }).click();
  const badge = page.getByTestId('adr-svc.api');
  await expect(badge).toHaveText('ADR');

  await page.getByTestId('decision-editor').getByRole('button', { name: 'All decisions' }).click();
  await badge.click();
  await expect(page.getByLabel('Decision title')).toHaveValue('One API for now');
});
