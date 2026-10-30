import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, defaultCatalog } from '@archguide/mcp-server';
import { Workspace } from '@archguide/workspace';

/**
 * An agent maps a .NET repository and a repository with bad practices through MCP
 * (Implementation.md §19, §20). The imported diagram shows the .NET concepts, and what the
 * code does against the rules is drawn as found, marked as an anti-pattern to address.
 */

const fixtures = fileURLToPath(new URL('../../../packages/analyzer/fixtures/', import.meta.url));
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** Analyzes a fixture with the real MCP tools and returns the project file. */
async function mapRepository(fixture: string, id: string): Promise<string> {
  const ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-map-')), 'architecture'));
  const server = createMcpServer({ workspace: ws, catalog: defaultCatalog(), readOnly: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: 'languages-e2e', version: '0' });
  await mcp.connect(b);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r.structuredContent)).toBeFalsy();
    return (r.structuredContent as { data?: Record<string, unknown> }).data ?? {};
  };
  await tool('create_project', { id, name: id });
  await tool('analyze_repository', { path: join(fixtures, fixture) });
  const applied = await tool('apply_analysis', {});
  await mcp.close();
  return JSON.stringify({ applied, file: await readFile(ws.fileFor(id), 'utf8') });
}

async function importProject(page: Page, id: string, file: string) {
  await page.goto('/');
  await page.getByLabel('Import project file').setInputFiles({
    name: `${id}.archguide.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  });
  await expect(page.getByTestId('toast').filter({ hasText: 'Imported' })).toBeVisible();
  await page.goto(`/#/p/${id}`);
}

test('a .NET repository mapped through MCP shows its services, worker and layers', async ({
  page,
}) => {
  const { file } = JSON.parse(await mapRepository('dotnet-aspnet-efcore', 'dotnet-shop')) as {
    file: string;
  };
  await importProject(page, 'dotnet-shop', file);
  const api = node(page, 'netsvc.orders-api');
  await expect(api).toContainText('Orders API');
  await expect(api).toContainText('.NET service');
  await expect(node(page, 'netwrk.invoicing-worker')).toContainText('.NET worker');
  await expect(node(page, 'dom.orders-domain')).toContainText('Orders domain');
  await expect(
    page.getByTestId('edge-label-rel.netsvc-orders-api-calls-netsvc-catalog-api'),
  ).toHaveText('calls');
});

test('an anti-pattern found in the code is drawn as found, marked, and explained', async ({
  page,
}) => {
  const { applied, file } = JSON.parse(await mapRepository('bad-practices', 'bad')) as {
    applied: { antiPatterns?: string[] };
    file: string;
  };
  expect(applied.antiPatterns).toHaveLength(1);
  const id = applied.antiPatterns![0]!;
  await importProject(page, 'bad', file);
  const label = page.getByTestId(`edge-label-${id}`);
  await expect(label).toHaveAttribute('data-anti-pattern', 'true');
  await expect(label).toHaveText('⚠ reads');
  await label.click();
  const card = page.getByTestId('anti-pattern-card');
  await expect(card).toContainText('imports the database client "pg"');
  await expect(card).toContainText('Browser code cannot connect to PostgreSQL');
  await expect(card).toContainText('apps/web/src/shared/lib/db.ts:2');
  // The Problems panel lists it as something to address.
  await expect(page.getByText('Anti-pattern found in the code').first()).toBeVisible();
  // While the code still does it, the mark cannot be cleared: the rules refuse the relation.
  await card.getByRole('button', { name: 'The code is fixed: clear the mark' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: /Browser code cannot connect/ }),
  ).toBeVisible();
  await expect(label).toHaveAttribute('data-anti-pattern', 'true');
});
