import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
