import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, defaultCatalog } from '@archguide/mcp-server';
import { Workspace } from '@archguide/workspace';

/**
 * The analyzed repository's documentation (Implementation.md §7.2): an agent documents the
 * blocks through MCP in the repository's language, the project JSON is imported, and the
 * diagram shows the names, descriptions and functions as written.
 */

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** A project documented by an agent through the real MCP tools, as its JSON file. */
async function documentedProject(): Promise<string> {
  const ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-docs-')), 'architecture'));
  const server = createMcpServer({ workspace: ws, catalog: defaultCatalog(), readOnly: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: 'docs-e2e', version: '0' });
  await mcp.connect(b);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.callTool({ name, arguments: args });
    expect(r.isError, JSON.stringify(r.structuredContent)).toBeFalsy();
  };
  await tool('create_project', { id: 'prodavnica', name: 'Prodavnica' });
  await tool('upsert_elements', {
    elements: [
      { id: 'svc.orders', kind: 'node.service', name: 'Orders' },
      { id: 'db.main', kind: 'pg.database', name: 'Main' },
      { id: 'schema.public', kind: 'pg.schema', name: 'public', parentId: 'db.main' },
    ],
  });
  await tool('write_documentation', {
    project: { lang: 'sr-Cyrl', summary: 'Продавница.', author: 'claude-code' },
    elements: [
      {
        id: 'svc.orders',
        name: 'Сервис поруџбина',
        description: 'Прима поруџбине из веб апликације.',
        function: 'Проверава корпу и чува поруџбину.',
        basis: 'read',
        sources: ['services/orders/README.md'],
      },
      { id: 'db.main', lang: 'ar', description: 'قاعدة البيانات الرئيسية', basis: 'deduced' },
    ],
  });
  await mcp.close();
  return readFile(ws.fileFor('prodavnica'), 'utf8');
}

test('imported documentation shows on the diagram in its own language', async ({ page }) => {
  const json = await documentedProject();
  await page.goto('/');
  await page.getByLabel('Import project file').setInputFiles({
    name: 'prodavnica.archguide.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect(page.getByTestId('toast').filter({ hasText: 'Imported' })).toBeVisible();
  await page.goto('/#/p/prodavnica');

  // The documentation's name replaces the model name; description and function sit under it.
  const orders = node(page, 'svc.orders');
  const label = orders.locator('[data-role="label"]');
  await expect(label).toHaveText('Сервис поруџбина');
  await expect(label).toHaveAttribute('lang', 'sr-Cyrl');
  const card = page.getByTestId('docs-svc.orders');
  await expect(card).toContainText('Прима поруџбине из веб апликације.');
  await expect(card).toContainText('Проверава корпу и чува поруџбину.');
  await expect(card).toHaveAttribute('lang', 'sr-Cyrl');
  await expect(card).toHaveAttribute('dir', 'ltr');
  // A container shows its description in its header, above its children.
  const db = node(page, 'db.main').locator('.ag-container-header').getByTestId('docs-db.main');
  await expect(db).toContainText('قاعدة البيانات الرئيسية');
  await expect(db).toHaveAttribute('lang', 'ar');
  await expect(db).toHaveAttribute('dir', 'rtl');

  // The inspector shows and edits it in the same language.
  await label.click();
  const form = page.getByTestId('docs-form');
  await expect(form).toHaveAttribute('open', '');
  await expect(form.getByLabel('Function: what it does')).toHaveValue(
    'Проверава корпу и чува поруџбину.',
  );
  await expect(form.getByLabel('Function: what it does')).toHaveAttribute('lang', 'sr-Cyrl');
  await form.getByLabel('Function: what it does').fill('Чува поруџбину.');
  await form.getByLabel('Name in the docs').click();
  await expect(card).toContainText('Чува поруџбину.');

  // "Docs" in the top bar hides and shows the texts under the shapes.
  const toggle = page.getByRole('button', { name: 'Docs' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(card).toHaveCount(0);
  await expect(label).toHaveText('Сервис поруџбина');
  await toggle.click();
  await expect(card).toBeVisible();
});
