import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProject, serializeProject } from '@archguide/core';
import { createMcpServer, defaultCatalog } from '@archguide/mcp-server';
import { Workspace, readLock } from '@archguide/workspace';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Phase 7 "done when" (Implementation.md §29): an agent creates, edits, validates and exports
 * a project only through MCP, and the open browser tab updates live. The test runs the
 * real `archguide serve` on port 4399; the Vite dev server proxies /api and /ws to it.
 * The port is fixed, so the tests of this file run one after another.
 */
test.describe.configure({ mode: 'serial' });

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const catalog = defaultCatalog();
let ws: Workspace;
let serve: ChildProcess;
let TOKEN: string;
let mcp: Client;

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** Calls an MCP tool and returns its envelope. */
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await mcp.callTool({ name, arguments: args });
  const env = r.structuredContent as { ok: boolean; data?: unknown; revision?: number };
  expect(env.ok, JSON.stringify(env)).toBe(true);
  return env;
}

test.beforeEach(async () => {
  ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-e2e-')), 'architecture'));
  await ws.writeConfig({ profile: catalog.profiles[0]!.id });
  serve = spawn(
    join(repo, 'node_modules', '.bin', 'tsx'),
    [
      join(repo, 'packages/cli/src/bin.ts'),
      '--workspace',
      ws.dir,
      '--json',
      'serve',
      '--port',
      '4399',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  TOKEN = await new Promise<string>((resolve, reject) => {
    let out = '';
    serve.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      try {
        resolve((JSON.parse(out) as { token: string }).token);
      } catch {
        // not complete yet
      }
    });
    serve.once('exit', (code) => reject(new Error(`archguide serve exited with ${code}`)));
  });
  expect(await readLock(ws)).toMatchObject({ port: 4399 });
  const mcpServer = createMcpServer({ workspace: ws, catalog, readOnly: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(a);
  mcp = new Client({ name: 'e2e-agent', version: '0' });
  await mcp.connect(b);
});

test.afterEach(async () => {
  await mcp.close();
  const exited = new Promise((r) => serve.once('exit', r));
  serve.kill('SIGINT');
  await exited;
});

test('an agent builds the architecture through MCP and the browser follows live', async ({
  page,
}) => {
  await page.goto(`/?t=${TOKEN}`);
  await expect(page.getByText('No projects yet.')).toBeVisible();
  // The token leaves the address bar but stays for this tab.
  expect(page.url()).not.toContain(TOKEN);

  // create_project: the workspace list updates by itself.
  await tool('create_project', { name: 'Shop' });
  await page.getByRole('link', { name: 'Shop' }).click();
  await expect(page.getByTestId('save-status')).toContainText('Saved · live');

  // upsert_elements and upsert_relations: shapes and the arrow appear on the open canvas.
  await tool('upsert_elements', {
    elements: [
      { id: 'svc.orders', kind: 'node.service', name: 'Orders API' },
      { id: 'db.shop', kind: 'pg.database', name: 'Shop DB' },
    ],
  });
  await expect(node(page, 'svc.orders')).toBeVisible();
  await expect(node(page, 'db.shop')).toBeVisible();
  await expect(page.getByTestId('live-note')).toContainText('last change by an agent (MCP)');
  await tool('upsert_relations', {
    relations: [{ sourceId: 'svc.orders', targetId: 'db.shop', type: 'writes' }],
  });
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // The browser edits too: the server saves it, and the agent reads it back.
  const name = page.getByLabel('Project name');
  await name.fill('Shop platform');
  await name.press('Enter');
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await expect
    .poll(async () => (await tool('get_architecture')).data as string)
    .toContain('Shop platform');

  // validate_project and export through MCP; a removal shows up live as well.
  const findings = await tool('validate_project');
  expect(Array.isArray(findings.data)).toBe(true);
  await tool('export', { format: 'agent-md', write: true });
  expect(await readFile(join(ws.dir, 'ARCHITECTURE.md'), 'utf8')).toContain('Orders API');
  await tool('remove_items', { ids: ['db.shop'] });
  await expect(node(page, 'db.shop')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  // Snapshots are left to git in serve mode.
  await expect(page.getByRole('button', { name: 'Snapshots' })).toHaveCount(0);

  // Lessons still run, on a practice project kept in the browser, not in the workspace.
  await page.goto('/#/learn');
  await page.getByRole('button', { name: 'Start: Your first full-stack architecture' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  expect((await ws.listProjects()).map((p) => p.id)).toEqual(['shop']);
});

test('a file changed outside the app while a change is in flight: discard or reapply', async ({
  page,
}) => {
  await ws.writeProject(
    createProject({ id: 'shop', name: 'Shop', profile: catalog.profiles[0]!.id }),
  );
  // Holds this tab's ops on their way to the server, so the file can change in between.
  let hold = false;
  const held: string[] = [];
  let toServer: ((message: string) => void) | undefined;
  await page.routeWebSocket(/\/ws/, (socket) => {
    const upstream = socket.connectToServer();
    toServer = (m) => upstream.send(m);
    socket.onMessage((m) => {
      if (hold && String(m).includes('"t":"ops"')) held.push(String(m));
      else upstream.send(m);
    });
    upstream.onMessage((m) => socket.send(m));
  });
  const release = () => {
    hold = false;
    for (const m of held.splice(0)) toServer?.(m);
  };
  const editOutside = async (newName: string) => {
    const p = await ws.readProject('shop');
    await writeFile(ws.fileFor('shop'), serializeProject({ ...p, name: newName }));
  };

  await page.goto(`/?t=${TOKEN}#/p/shop`);
  const name = page.getByLabel('Project name');
  const banner = page.getByRole('alertdialog', { name: 'Conflict' });
  await expect(page.getByTestId('save-status')).toContainText('Saved · live');

  // Discard: the file's version wins.
  hold = true;
  await name.fill('Renamed here');
  await name.press('Enter');
  await expect(page.getByTestId('save-status')).toContainText('Saving…');
  await editOutside('Renamed in git');
  await expect(banner).toContainText('You have 1 unsaved change.');
  await expect(page.getByTestId('save-status')).toContainText('Conflict');
  release(); // the server refuses it: it was made for the old version
  await banner.getByRole('button', { name: 'Discard' }).click();
  await expect(banner).toHaveCount(0);
  await expect(name).toHaveValue('Renamed in git');
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  // Reapply: this tab's change goes on top of the file's version.
  hold = true;
  await name.fill('Mine');
  await name.press('Enter');
  await editOutside('Theirs');
  await expect(banner).toBeVisible();
  release();
  await banner.getByRole('button', { name: 'Reapply your changes' }).click();
  await expect(name).toHaveValue('Mine');
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await expect.poll(async () => (await ws.readProject('shop')).name).toBe('Mine');
});

test('an agent analyzes the repository; a person reviews the suggestions and the data ownership', async ({
  page,
}) => {
  // The workspace sits in a copy of the bad-practices fixture repository.
  await cp(join(repo, 'packages/analyzer/fixtures/bad-practices'), dirname(ws.dir), {
    recursive: true,
  });
  await tool('create_project', { name: 'Bad' });
  await page.goto(`/?t=${TOKEN}#/p/bad`);
  await expect(page.getByTestId('save-status')).toContainText('Saved · live');
  await page.getByRole('button', { name: 'Analysis' }).click();
  const dialog = page.getByRole('dialog', { name: 'Analysis' });
  await expect(dialog).toContainText('No analysis yet');

  // The agent runs the analyzer; the open dialog picks up the new last.json by itself.
  await tool('analyze_repository');
  const suggestions = dialog.getByTestId('suggestion');
  await expect(suggestions.first()).toBeVisible();
  const orders = suggestions.filter({ hasText: /^Orders\s*Node service/ });
  await expect(
    orders.getByRole('link', { name: /services\/orders\/package\.json/ }),
  ).toHaveAttribute('href', new RegExp(`^vscode://file/.+/services/orders/package\\.json:\\d+`));
  await expect(dialog.getByTestId('analysis-finding').filter({ hasText: 'RNP-003' })).toContainText(
    'apps/web/src/shared/lib/db.ts:2',
  );

  // Accept one: it is added as reviewed and shown on the canvas.
  await orders.getByRole('button', { name: 'Accept' }).click();
  await expect(node(page, 'svc.orders')).toBeVisible();
  // Reject one: it leaves the list, and the workspace remembers it for the next analysis.
  const billing = suggestions.filter({ hasText: /^Billing\s*Node service/ });
  await billing.getByRole('button', { name: 'Reject' }).click();
  await expect(billing).toHaveCount(0);
  await expect
    .poll(async () => readFile(ws.localPath('analysis', 'rejected.json'), 'utf8').catch(() => ''))
    .toContain('pkg:services/billing');
  // The rest above 60%.
  await dialog.getByRole('button', { name: 'Accept all' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  const saved = await ws.readProject('bad');
  expect(saved.model.elements.find((e) => e.id === 'svc.orders')?.source).toMatchObject({
    origin: 'inferred',
    reviewed: true,
  });
  expect(saved.model.elements.some((e) => e.name === 'Billing')).toBe(false);

  // The database view colors the data by its owner and lists shared data.
  await page.getByRole('button', { name: 'Views' }).click();
  await page.getByRole('menuitem', { name: 'Create database view' }).click();
  const legend = page.getByRole('complementary', { name: 'Data ownership' });
  await expect(legend).toBeVisible();
  await expect(node(page, 'tbl.invoice')).toBeVisible();
  await expect(node(page, 'app.web')).toHaveCount(0);
});

/** Runs the CLI in the workspace and returns its exit code and output. */
function cli(...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      join(repo, 'node_modules', '.bin', 'tsx'),
      [join(repo, 'packages/cli/src/bin.ts'), '--workspace', ws.dir, ...args],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    child.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.once('exit', (code) => resolve({ code: code ?? 1, out }));
  });
}

test('Phase 9: baseline from a scan, a change set in the UI, the plan, the agent builds it, check passes', async ({
  page,
}) => {
  // Baseline: the repository scan, accepted by the agent.
  const root = dirname(ws.dir);
  await cp(join(repo, 'packages/analyzer/fixtures/vite-express-prisma'), root, { recursive: true });
  await tool('create_project', { name: 'Shop' });
  await tool('analyze_repository');
  await tool('apply_analysis', { minConfidence: 0 });
  expect((await ws.readProject('shop')).model.elements.some((e) => e.id === 'svc.api')).toBe(true);

  // A person plans the feature in the browser.
  await page.goto(`/?t=${TOKEN}#/p/shop`);
  await expect(page.getByTestId('save-status')).toContainText('Saved · live');
  await page.getByRole('button', { name: 'Change sets' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change sets' });
  await dialog.getByLabel('Change set name').fill('Send receipts');
  await dialog.getByLabel('Change set description').fill('E-mail a receipt after an order.');
  await dialog.getByRole('button', { name: 'Start change set' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('changeset-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Full' }).click();
  await page.getByTestId('palette-item-node.worker').click();
  await page.getByLabel('Element name').fill('Mailer');
  await page.getByLabel('Element name').press('Enter');
  await expect(node(page, 'wrk.mailer')).toBeVisible();
  await page.getByRole('tab', { name: 'properties' }).click();
  await page.getByLabel('Code paths (one glob per line)').fill('services/mailer');
  await page.getByLabel('Code paths (one glob per line)').press('Tab');
  // Recorded into the change set on the server; the baseline file is unchanged.
  await expect
    .poll(async () => (await ws.readProject('shop')).changeSets[0]?.ops.length ?? 0)
    .toBeGreaterThan(1);
  expect((await ws.readProject('shop')).model.elements.some((e) => e.id === 'wrk.mailer')).toBe(
    false,
  );

  await page.getByRole('button', { name: 'Tasks and details…' }).click();
  await dialog.getByRole('tab', { name: /Tasks/ }).click();
  await dialog.getByTestId('generate-tasks').click();
  await dialog.getByRole('button', { name: 'Export plan…' }).click();
  const preview = page.getByRole('dialog', { name: 'Export' }).getByTestId('export-preview');
  await expect(preview).toContainText('# Plan: Send receipts');
  await expect(preview).toContainText('**Create wrk.mailer**');
  await expect(preview).toContainText('Code: `services/mailer`');
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Close' }).click();

  // The agent reads the plan, builds the code, and marks the change set implemented.
  const plan = await mcp.readResource({
    uri: 'archguide://projects/shop/change-sets/cs.send-receipts',
  });
  expect((plan.contents[0] as { text: string }).text).toContain('**Create wrk.mailer**');
  await mkdir(join(root, 'services/mailer/src'), { recursive: true });
  await writeFile(
    join(root, 'services/mailer/package.json'),
    JSON.stringify({ name: '@shop/mailer', private: true, dependencies: { 'pg-boss': '^10.0.0' } }),
  );
  await writeFile(
    join(root, 'services/mailer/src/main.ts'),
    "import PgBoss from 'pg-boss';\n\nconst boss = new PgBoss(process.env.DATABASE_URL!);\nawait boss.start();\nawait boss.work('send-receipt', async ([job]) => console.log(job?.data));\n",
  );
  await tool('update_change_set', { changeSetId: 'cs.send-receipts', status: 'implemented' });

  // The browser follows: the change is now part of the baseline.
  await expect(page.getByTestId('changeset-banner')).toHaveCount(0);
  await expect(node(page, 'wrk.mailer')).toBeVisible();
  await expect(page.getByTestId('diff-wrk.mailer')).toHaveCount(0);

  // CI gate: the model, the analysis, the dependency rules and drift agree.
  const check = await cli('check', '--format', 'json');
  expect(check.code, check.out).toBe(0);
  const report = JSON.parse(check.out) as { items: { ruleId: string; message: string }[] };
  expect(report.items.filter((i) => i.ruleId.startsWith('DRIFT'))).toEqual([]);
});
