import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Phase 6 (Implementation.md §17): lessons, the library, quizzes, progress, the lab. */

async function finishLesson(page: Page) {
  const player = page.getByTestId('lesson-player');
  for (let i = 0; i < 20; i++) {
    if (await player.getByTestId('lesson-complete').isVisible()) return;
    const showMe = player.getByRole('button', { name: 'Show me' });
    if (await showMe.isVisible()) {
      await showMe.click();
      await expect(player.getByTestId('lesson-status')).toContainText('Done!');
    }
    const next = player.getByRole('button', { name: /^Next/ });
    if (await next.isVisible()) await next.click();
    else await player.getByRole('button', { name: 'Finish' }).click();
  }
  throw new Error('The lesson did not finish');
}

test('a lesson runs on the canvas with checks, hints and "Show me", and progress is kept', async ({
  page,
}) => {
  await page.goto('/#/learn');
  await expect(page.getByTestId('progress-summary')).toContainText('0 of');
  await page.getByRole('button', { name: 'Start: Your first full-stack architecture' }).click();

  const player = page.getByTestId('lesson-player');
  await expect(player).toContainText('Three parts, three jobs');
  await player.getByRole('button', { name: /^Next/ }).click();

  // A task step: not done, with a hint; the canvas is the real editor.
  await expect(player.getByTestId('lesson-status')).toContainText('Not done yet');
  await expect(player.getByRole('button', { name: /^Next/ })).toBeDisabled();
  await player.getByRole('button', { name: 'Hint' }).click();
  await expect(player).toContainText('atom icon');

  // Doing it yourself passes the check.
  await page.getByTestId('palette-item-react.app').click();
  await page.keyboard.press('Escape');
  await expect(player.getByTestId('lesson-status')).toContainText('Done!');
  await expect(player.getByTestId('lesson-success')).toContainText('runs in the browser');

  // "Show me" solves a step and places the shapes on the canvas.
  await player.getByRole('button', { name: /^Next/ }).click();
  await player.getByRole('button', { name: 'Show me' }).click();
  await expect(page.locator('.react-flow__node[data-id="svc.api"]')).toBeVisible();
  await expect(player.getByTestId('lesson-status')).toContainText('Done!');

  await finishLesson(page);
  await page.getByRole('link', { name: 'Back to the lessons' }).click();
  const card = page.getByTestId('lesson-lesson.first-full-stack');
  await expect(card.getByTestId('lesson-status')).toHaveText('Finished');

  // Progress survives a reload (IndexedDB).
  await page.reload();
  await expect(card.getByTestId('lesson-status')).toHaveText('Finished');
  await expect(page.getByTestId('progress-summary')).toContainText('1 of');
});

test('the library: search, a text at the reader’s level, and its quiz', async ({ page }) => {
  await page.goto('/#/library');
  await page.getByLabel('Search the library').fill('isolation');
  await expect(page.getByRole('status')).toContainText('for “isolation”');
  await page
    .getByRole('link', { name: /Transactions/ })
    .first()
    .click();
  await expect(page.locator('[data-testid^="doc-"]')).toBeVisible();

  // Levels change the depth of the text.
  await page.getByRole('button', { name: 'Senior' }).click();
  await page.getByRole('button', { name: 'Beginner' }).click();

  await page.goto('/#/library/react.server-state');
  const quiz = page.getByTestId('quiz-react.server-state');
  await quiz.getByLabel('localStorage').check();
  await quiz.getByRole('button', { name: 'Check' }).click();
  await expect(quiz.getByRole('status')).toHaveText('Not quite');
  await quiz.getByLabel('A server-state cache such as TanStack Query').check();
  await quiz.getByRole('button', { name: 'Check' }).click();
  await expect(quiz.getByRole('status')).toHaveText('Correct');
  await expect(quiz).toContainText('A server-state cache handles loading');

  // The answer and the read text are remembered.
  await page.reload();
  await expect(page.getByTestId('quiz-react.server-state').getByRole('status')).toHaveText(
    'Correct',
  );
  await page.goto('/#/library');
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'State management — server state' })
      .getByLabel('read'),
  ).toBeVisible();
});

test('progress can be exported and imported', async ({ page }) => {
  await page.goto('/#/learn');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export progress' }).click();
  const file = await (await download).path();
  const { readFileSync } = await import('node:fs');
  expect(JSON.parse(readFileSync(file, 'utf8')).format).toBe('archguide-progress');

  const imported = {
    format: 'archguide-progress',
    version: 1,
    lessons: {
      'lesson.first-full-stack': {
        step: 6,
        completed: ['welcome'],
        startedAt: '2026-10-01T00:00:00.000Z',
        finishedAt: '2026-10-01T01:00:00.000Z',
      },
    },
    read: {},
    quiz: {},
  };
  await page.getByLabel('Import progress file').setInputFiles({
    name: 'progress.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.getByTestId('toast').filter({ hasText: 'Progress imported' })).toBeVisible();
  await expect(
    page.getByTestId('lesson-lesson.first-full-stack').getByTestId('lesson-status'),
  ).toHaveText('Finished');

  await page.getByLabel('Import progress file').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"archguide-project"}'),
  });
  await expect(
    page.getByTestId('toast').filter({ hasText: 'not an ArchitectureGuide progress file' }),
  ).toBeVisible();
});

test('the concurrency lab replays a lost update and its fixes, and sets an arrow', async ({
  page,
}) => {
  await page.goto('/#/lab');
  const lab = page.getByTestId('concurrency-lab');
  await lab.getByRole('button', { name: 'Show the end' }).click();
  await expect(lab.getByTestId('lab-outcome')).toContainText('Final stock 4, expected 3');
  await expect(lab.getByTestId('lab-outcome')).toContainText('Lost update');

  await lab.getByRole('radio', { name: 'Row lock' }).click();
  await lab.getByRole('button', { name: 'Show the end' }).click();
  await expect(lab.getByTestId('lab-outcome')).toContainText('correct');
  await expect(lab.locator('[data-kind="wait"]')).toHaveCount(1);

  // From a writes arrow in the editor: "Use on this arrow" sets its concurrency control.
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the starter' }).click();
  await page.locator('.react-flow__edge[data-id="rel.api-writes-public"]').click({ force: true });
  await page.getByRole('button', { name: 'Try it in the concurrency lab' }).click();
  const dialog = page.getByRole('dialog', { name: 'Concurrency lab' });
  await dialog.getByRole('radio', { name: 'Optimistic (version column)' }).click();
  await dialog.getByRole('button', { name: /^Use on this arrow/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(/concurrency control/i)).toHaveValue('optimistic-version');
});
