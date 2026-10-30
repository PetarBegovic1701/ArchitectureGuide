import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Workspace } from '@archguide/workspace';
import type { Project } from '@archguide/core';
import { createMcpServer, defaultCatalog } from '.';

const catalog = defaultCatalog();
let ws: Workspace;
let client: Client;

async function connect(readOnly = false) {
  const server = createMcpServer({ workspace: ws, catalog, readOnly });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'contract-test', version: '0' });
  await client.connect(b);
}

/** A tool envelope, loosely typed for assertions. */
interface Result {
  ok: boolean;
  revision?: number;
  changed?: string[];
  findings?: { ruleId: string; targetIds: string[]; fixes: string[] }[];
  errors?: { code: string; message: string; hint?: string }[];
  hints?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions read any shape
  data?: any;
}

/** Calls a tool and returns its envelope; isError must agree with ok. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const r = await client.callTool({ name, arguments: args });
  const env = r.structuredContent as unknown as Result;
  expect(Boolean(r.isError)).toBe(!env.ok);
  return env;
}

const onDisk = async (id = 'shop') => JSON.parse(await readFile(ws.fileFor(id), 'utf8')) as Project;

beforeEach(async () => {
  ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-mcp-')), 'architecture'));
  await connect();
});

afterEach(() => client.close());

describe('MCP tools', () => {
  it('lists every Phase 7 tool with a description', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_annotation',
        'analyze_repository',
        'create_change_set',
        'generate_tasks',
        'get_change_set',
        'list_change_sets',
        'update_change_set',
        'apply_analysis',
        'diff_with_repository',
        'generate_enforcement',
        'add_decision',
        'add_note',
        'apply_quick_fix',
        'apply_template',
        'check_lesson_step',
        'create_project',
        'draft_tour',
        'explain_concept',
        'export',
        'get_architecture',
        'get_catalog',
        'get_lesson',
        'get_onboarding',
        'list_lessons',
        'list_projects',
        'list_templates',
        'list_tours',
        'remove_items',
        'rename_id',
        'search_learning',
        'suppress_finding',
        'upsert_elements',
        'upsert_relations',
        'upsert_tour',
        'validate_project',
        'write_documentation',
      ].sort(),
    );
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(10);
    expect(tools.find((t) => t.name === 'get_architecture')?.annotations?.readOnlyHint).toBe(true);
  });

  it('creates a project from a template, makes it the default, and reads it back', async () => {
    expect((await call('list_projects')).hints?.[0]).toMatch(/create_project/);
    const created = await call('create_project', { name: 'Shop', templateId: 'T1' });
    expect(created).toMatchObject({ ok: true, revision: 0, data: { id: 'shop' } });
    expect(created.data.elements).toBeGreaterThan(2);
    expect(await call('create_project', { name: 'Shop' })).toMatchObject({
      ok: false,
      errors: [{ code: 'EXISTS' }],
    });

    const list = await call('list_projects');
    expect(list.data).toMatchObject([{ id: 'shop', default: true }]);
    const md = await call('get_architecture');
    expect(md.data).toContain('# ');
    expect(md.data).toContain('Shop API');
    const r = await client.callTool({ name: 'get_architecture', arguments: {} });
    // Long texts come as their own content block, so agents read Markdown, not escaped JSON.
    expect((r.content as { text: string }[])[1]?.text).toBe(md.data);
    const json = await call('get_architecture', { format: 'json' });
    expect(JSON.parse(json.data).id).toBe('shop');
  });

  describe('editing', () => {
    beforeEach(async () => {
      await call('create_project', { id: 'shop', name: 'Shop' });
    });

    it('upserts elements and relations, bumps the revision, and places new shapes', async () => {
      const els = await call('upsert_elements', {
        elements: [
          { kind: 'react.app', name: 'Web' },
          { kind: 'node.service', name: 'Orders API' },
          { kind: 'node.module', name: 'Billing', parentId: 'svc.orders-api' },
        ],
      });
      expect(els).toMatchObject({ ok: true, revision: 1 });
      expect(els.changed).toHaveLength(3);
      const [web, api] = els.changed as string[];

      const rels = await call('upsert_relations', {
        relations: [{ sourceId: web, targetId: api }],
      });
      expect(rels).toMatchObject({ ok: true, revision: 2 });
      expect(rels.hints?.[0]).toMatch(/error\(s\)/);

      const p = await onDisk();
      expect(p.revision).toBe(2);
      expect(p.views[0]!.nodes.map((n) => n.elementId).sort()).toEqual(
        [...(els.changed as string[])].sort(),
      );
      expect(p.views[0]!.edges).toHaveLength(1);
    });

    it('writes the repository documentation in its own language', async () => {
      await call('upsert_elements', {
        elements: [
          { id: 'svc.orders', kind: 'node.service', name: 'Orders' },
          {
            id: 'db.main',
            kind: 'pg.database',
            name: 'Main',
            docs: { description: 'Hauptdatenbank', basis: 'deduced' },
          },
        ],
      });
      const r = await call('write_documentation', {
        project: {
          lang: 'de',
          summary: 'Ein Shop.',
          author: 'claude-code',
          sources: ['README.md'],
        },
        elements: [
          {
            id: 'svc.orders',
            name: 'Bestelldienst',
            description: 'Nimmt Bestellungen an.',
            function: 'Prüft den Warenkorb und speichert die Bestellung.',
            basis: 'read',
            sources: ['services/orders/README.md'],
          },
        ],
      });
      expect(r).toMatchObject({ ok: true, changed: ['svc.orders'], data: { documented: 1 } });
      const p = await onDisk();
      expect(p.docs).toMatchObject({ lang: 'de', summary: 'Ein Shop.', sources: ['README.md'] });
      expect(p.model.elements.find((e) => e.id === 'svc.orders')!.docs).toEqual({
        name: 'Bestelldienst',
        description: 'Nimmt Bestellungen an.',
        function: 'Prüft den Warenkorb und speichert die Bestellung.',
        basis: 'read',
        sources: ['services/orders/README.md'],
      });
      expect(p.model.elements.find((e) => e.id === 'db.main')!.docs).toEqual({
        description: 'Hauptdatenbank',
        basis: 'deduced',
      });
      const md = await call('get_architecture');
      expect(md.data).toContain('## Documentation');
      expect(md.data).toContain('**Bestelldienst**');
      expect(md.data).toContain('Function: Prüft den Warenkorb und speichert die Bestellung.');

      const unknown = await call('write_documentation', {
        elements: [{ id: 'svc.nope', description: 'x' }],
      });
      expect(unknown).toMatchObject({ ok: false, errors: [{ code: 'ID_NOT_FOUND' }] });
      const badLang = await call('write_documentation', {
        elements: [{ id: 'svc.orders', lang: 'German' }],
      });
      expect(badLang.ok).toBe(false);
    });

    it('keeps anti-patterns found in the code, marked, and reports them to address', async () => {
      await call('upsert_elements', {
        elements: [
          { id: 'app.web', kind: 'react.app', name: 'Web', status: 'existing' },
          { id: 'db.main', kind: 'pg.database', name: 'Main', status: 'existing' },
        ],
      });
      // Without a mark the rules refuse it, and the hint says how to record it as found.
      const refused = await call('upsert_relations', {
        relations: [{ sourceId: 'app.web', targetId: 'db.main', type: 'reads' }],
      });
      expect(refused).toMatchObject({ ok: false, errors: [{ code: 'RELATION_NOT_ALLOWED' }] });

      const kept = await call('upsert_relations', {
        relations: [
          {
            sourceId: 'app.web',
            targetId: 'db.main',
            type: 'reads',
            status: 'existing',
            antiPattern: {
              note: 'The web app imports pg and queries the database',
              evidence: [{ path: 'apps/web/src/db.ts', line: 2 }],
            },
          },
        ],
      });
      expect(kept.ok).toBe(true);
      expect(kept.data?.antiPatterns).toBeUndefined();
      expect(kept.findings!.map((f) => f.ruleId)).toContain('AP-019');
      const rel = (await onDisk()).model.relations.find((r) => r.sourceId === 'app.web')!;
      expect(rel.antiPattern).toMatchObject({
        note: 'The web app imports pg and queries the database',
        violates: expect.stringMatching(/Browser code cannot connect to PostgreSQL/),
      });

      // asFound: the refused nesting is kept and marked, with the rule it breaks.
      const nested = await call('upsert_elements', {
        asFound: true,
        elements: [
          { id: 'mod.billing', kind: 'node.module', name: 'Billing', parentId: 'db.main' },
        ],
      });
      expect(nested).toMatchObject({ ok: true, data: { antiPatterns: ['mod.billing'] } });
      expect((await onDisk()).model.elements.find((e) => e.id === 'mod.billing')).toMatchObject({
        parentId: 'db.main',
        antiPattern: { note: 'Found in the analyzed code' },
      });
      const all = await call('validate_project');
      expect(
        all.data
          .filter((f: { ruleId: string }) => f.ruleId === 'AP-019')
          .map((f: { targetIds: string[] }) => f.targetIds[0])
          .sort(),
      ).toEqual([rel.id, 'mod.billing'].sort());
    });

    it('explains mistakes: unknown kinds, ambiguous types and refused pairs', async () => {
      const bad = await call('upsert_elements', { elements: [{ kind: 'node.servce', name: 'X' }] });
      expect(bad).toMatchObject({ ok: false, errors: [{ code: 'UNKNOWN_KIND' }] });
      expect(bad.errors![0]!.hint).toContain('node.service');
      expect((await onDisk()).revision).toBe(0);

      await call('upsert_elements', {
        elements: [
          { id: 'svc.api', kind: 'node.service', name: 'API' },
          { id: 'db.main', kind: 'pg.database', name: 'Main' },
        ],
      });
      const ambiguous = await call('upsert_relations', {
        relations: [{ sourceId: 'svc.api', targetId: 'db.main' }],
      });
      expect(ambiguous.ok).toBe(false);
      expect(ambiguous.errors![0]!.message).toMatch(/Several relation types fit/);
      const refused = await call('upsert_relations', {
        relations: [{ sourceId: 'db.main', targetId: 'svc.api', type: 'calls' }],
      });
      expect(refused).toMatchObject({ ok: false });
    });

    it('returns only the findings a change introduced; validates, fixes and suppresses', async () => {
      await call('upsert_elements', {
        elements: [
          { id: 'svc.a', kind: 'node.service', name: 'A' },
          { id: 'svc.b', kind: 'node.service', name: 'B' },
          { id: 'db.main', kind: 'pg.database', name: 'Main' },
        ],
      });
      await call('upsert_relations', {
        relations: [{ sourceId: 'svc.a', targetId: 'db.main', type: 'writes' }],
      });
      const second = await call('upsert_relations', {
        relations: [{ sourceId: 'svc.b', targetId: 'db.main', type: 'writes' }],
      });
      expect(second.ok).toBe(true);
      const introduced = second.findings!;
      expect(introduced.length).toBeGreaterThan(0);
      const shared = introduced.find((f) => f.targetIds.includes('db.main'))!;
      expect(shared).toBeDefined();

      const all = await call('validate_project');
      expect(all.data.map((f: { ruleId: string }) => f.ruleId)).toContain(shared.ruleId);

      // A repeated write introduces nothing new.
      const again = await call('upsert_elements', {
        elements: [{ id: 'svc.a', kind: 'node.service', name: 'A2' }],
      });
      expect(again.findings).toEqual([]);

      const suppressed = await call('suppress_finding', {
        ruleId: shared.ruleId,
        targetIds: shared.targetIds,
        reason: 'Both services are one team, split planned for Q3.',
      });
      expect(suppressed.ok).toBe(true);
      const after = await call('validate_project');
      expect(after.data.map((f: { ruleId: string }) => f.ruleId)).not.toContain(shared.ruleId);
      const withSuppressed = await call('validate_project', { includeSuppressed: true });
      expect(
        withSuppressed.data.find((f: { ruleId: string }) => f.ruleId === shared.ruleId)?.suppressed,
      ).toMatch(/Q3/);

      const fixable = (await call('validate_project')).data.find(
        (f: { fixes: string[] }) => f.fixes.length > 0,
      );
      if (fixable) {
        const fixed = await call('apply_quick_fix', {
          ruleId: fixable.ruleId,
          targetIds: fixable.targetIds,
        });
        expect(fixed).toMatchObject({ ok: true, data: { applied: fixable.fixes[0] } });
      }
      expect(await call('apply_quick_fix', { ruleId: 'AP-999', targetIds: ['x'] })).toMatchObject({
        ok: false,
        errors: [{ code: 'NOT_FOUND' }],
      });
    });

    it('stamps a template next to the diagram, renames and removes items', async () => {
      await call('upsert_elements', {
        elements: [{ id: 'svc.old', kind: 'node.service', name: 'Old' }],
      });
      const stamped = await call('apply_template', {
        templateId: 'rnp.starter',
        params: { appName: 'Admin' },
      });
      expect(stamped.ok).toBe(true);
      const p = await onDisk();
      const old = p.views[0]!.nodes.find((n) => n.elementId === 'svc.old')!;
      const topLevel = new Set(p.model.elements.filter((e) => !e.parentId).map((e) => e.id));
      const stampedNodes = p.views[0]!.nodes.filter(
        (n) => (stamped.changed as string[]).includes(n.elementId) && topLevel.has(n.elementId),
      );
      expect(stampedNodes.length).toBeGreaterThan(0);
      expect(Math.min(...stampedNodes.map((n) => n.x))).toBeGreaterThan(old.x);

      expect(
        await call('apply_template', { templateId: 'T1', params: { appName: 42 } }),
      ).toMatchObject({ ok: false });
      expect(await call('rename_id', { from: 'svc.old', to: 'svc.legacy' })).toMatchObject({
        ok: true,
      });
      expect(await call('remove_items', { ids: ['svc.legacy'] })).toMatchObject({ ok: true });
      expect((await onDisk()).model.elements.some((e) => e.id.startsWith('svc.legacy'))).toBe(
        false,
      );
    });

    it('adds notes, decisions, annotations and tours', async () => {
      await call('upsert_elements', {
        elements: [{ id: 'svc.api', kind: 'node.service', name: 'API' }],
      });
      expect(await call('add_note', { title: 'Why one API', body: 'See @svc.api' })).toMatchObject({
        changed: ['note.why-one-api'],
      });
      expect(
        await call('add_decision', {
          title: 'Use PostgreSQL',
          context: 'We need transactions.',
          decision: 'PostgreSQL 17.',
          consequences: 'One more service to run.',
        }),
      ).toMatchObject({ ok: true, changed: ['adr.use-postgresql'] });
      expect(await call('add_annotation', { kind: 'comment', text: 'Hot path' })).toMatchObject({
        ok: false,
      });
      expect(
        await call('add_annotation', { kind: 'comment', text: 'Hot path', anchorId: 'svc.api' }),
      ).toMatchObject({
        ok: true,
      });
      const draft = await call('draft_tour');
      expect(draft.data.steps.length).toBeGreaterThan(0);
      expect(await call('upsert_tour', { tour: draft.data })).toMatchObject({ ok: true });
      expect((await call('list_tours')).data).toHaveLength(1);
      const p = await onDisk();
      expect(p.notes).toHaveLength(1);
      expect(p.decisions).toHaveLength(1);
      expect(p.views[0]!.annotations).toHaveLength(1);
    });

    it('exports text, and writes files to the workspace or the configured path', async () => {
      await call('upsert_elements', {
        elements: [{ id: 'svc.api', kind: 'node.service', name: 'API' }],
      });
      const md = await call('export', { format: 'agent-md' });
      expect(md.data).toContain('API');
      const written = await call('export', { format: 'agent-md', write: true });
      expect(written.data.written).toEqual([join(ws.dir, 'ARCHITECTURE.md')]);
      expect(await readFile(join(ws.dir, 'ARCHITECTURE.md'), 'utf8')).toBe(md.data);

      await ws.writeConfig({
        ...(await ws.readConfig()),
        exports: [{ format: 'mermaid', out: '../docs/shop.mmd' }],
      });
      const mmd = await call('export', { format: 'mermaid', write: true });
      expect(mmd.data.written).toEqual([join(ws.dir, '..', 'docs', 'shop.mmd')]);
      expect((await call('get_onboarding', { level: 'beginner' })).data).toMatch(/^# /);
    });
  });

  it('teaches: explains concepts, rules and topics, searches, and checks lesson steps', async () => {
    const store = await call('explain_concept', { id: 'react.client-store' });
    expect(store.data).toContain('Typical connections');
    expect(await call('explain_concept', { id: 'RNP-001' })).toMatchObject({ ok: true });
    const missing = await call('explain_concept', { id: 'react.client-stor' });
    expect(missing).toMatchObject({ ok: false, errors: [{ code: 'NOT_FOUND' }] });

    const found = await call('search_learning', { query: 'transaction' });
    expect(found.data.length).toBeGreaterThan(0);

    const lessons = (await call('list_lessons')).data as { id: string; steps: number }[];
    expect(lessons.length).toBeGreaterThanOrEqual(20);
    const lesson = await call('get_lesson', { lessonId: lessons[0]!.id });
    expect(lesson.data.steps[0]).not.toHaveProperty('solution');
    const withSolutions = await call('get_lesson', {
      lessonId: lessons[0]!.id,
      includeSolutions: true,
    });
    expect(withSolutions.data.steps.length).toBe(lessons[0]!.steps);

    await call('create_project', { id: 'shop', name: 'Shop' });
    const check = await call('check_lesson_step', {
      lessonId: lessons[0]!.id,
      stepId: withSolutions.data.steps[0].id,
    });
    expect(check.data).toHaveProperty('passed');
  });

  it('refuses every write in read-only mode', async () => {
    await call('create_project', { id: 'shop', name: 'Shop' });
    await client.close();
    await connect(true);
    expect(
      await call('upsert_elements', { elements: [{ kind: 'node.service', name: 'X' }] }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'READ_ONLY' }],
    });
    expect(await call('create_project', { name: 'Other' })).toMatchObject({ ok: false });
    expect(await call('export', { format: 'agent-md', write: true })).toMatchObject({ ok: false });
    expect(await call('validate_project')).toMatchObject({ ok: true });
  });
});

describe('MCP resources and prompts', () => {
  it('serves projects, the catalog, rules and templates', async () => {
    await call('create_project', { id: 'shop', name: 'Shop', templateId: 'T1' });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        'archguide://projects',
        'archguide://catalog',
        'archguide://projects/shop',
        'archguide://rules/RNP-001',
      ]),
    );
    const read = async (uri: string) =>
      ((await client.readResource({ uri })).contents[0] as { text: string }).text;
    expect(await read('archguide://projects/shop')).toContain('Shop API');
    expect(await read('archguide://projects/shop/yaml')).toContain('shop');
    expect(
      JSON.parse(await read('archguide://catalog/pg.')).concepts.every((c: { id: string }) =>
        c.id.startsWith('pg.'),
      ),
    ).toBe(true);
    expect(await read('archguide://rules/RNP-001')).toMatch(/^# RNP-001/);
    expect(JSON.parse(await read('archguide://templates/T1')).id).toBe('rnp.starter');
  });

  it('offers the plan-feature prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['plan-feature', 'map-repository', 'review-change']);
    const p = await client.getPrompt({ name: 'plan-feature', arguments: { feature: 'Refunds' } });
    expect((p.messages[0]!.content as { text: string }).text).toContain('Refunds');
  });
});

describe('MCP change sets (plan-feature end to end)', () => {
  beforeEach(async () => {
    await call('create_project', { id: 'shop', name: 'Shop' });
    await call('upsert_elements', {
      elements: [
        {
          id: 'svc.orders',
          kind: 'node.service',
          name: 'Orders',
          status: 'existing',
          codePaths: ['services/orders'],
        },
        { id: 'db.shop', kind: 'pg.database', name: 'Shop DB', status: 'existing' },
        {
          id: 'schema.orders',
          kind: 'pg.schema',
          name: 'orders',
          parentId: 'db.shop',
          status: 'existing',
        },
      ],
    });
    await call('upsert_relations', {
      relations: [
        { sourceId: 'svc.orders', targetId: 'schema.orders', type: 'migrates' },
        { sourceId: 'svc.orders', targetId: 'schema.orders', type: 'writes' },
      ],
    });
  });

  it('records edits into a change set, checks them, orders the tasks and writes the plan', async () => {
    const baseline = await onDisk();
    const created = await call('create_change_set', {
      name: 'Send receipts',
      description: 'Email a receipt after an order is paid.',
    });
    expect(created).toMatchObject({ ok: true, data: { id: 'cs.send-receipts' } });
    const changeSetId = 'cs.send-receipts';

    const els = await call('upsert_elements', {
      changeSetId,
      elements: [
        { id: 'wrk.mailer', kind: 'node.worker', name: 'Mailer', codePaths: ['services/mailer'] },
        { id: 'jobs.mail', kind: 'pg.job-queue', name: 'mail', parentId: 'db.shop' },
        { id: 'svc.billing', kind: 'node.service', name: 'Billing' },
      ],
    });
    expect(els.ok).toBe(true);
    expect(els.hints?.join(' ')).toMatch(/Recorded into change set "cs.send-receipts"/);
    const rels = await call('upsert_relations', {
      changeSetId,
      relations: [
        {
          sourceId: 'svc.orders',
          targetId: 'jobs.mail',
          type: 'enqueues',
          label: 'receipt.send',
          inTransaction: true,
        },
        { sourceId: 'wrk.mailer', targetId: 'jobs.mail', type: 'processes', label: 'receipt.send' },
      ],
    });
    expect(rels.ok).toBe(true);
    // A change introduces a finding: a second service writes the orders schema.
    const bad = await call('upsert_relations', {
      changeSetId,
      relations: [{ sourceId: 'svc.billing', targetId: 'schema.orders', type: 'writes' }],
    });
    expect(bad.findings?.some((f) => f.targetIds.includes('schema.orders'))).toBe(true);
    const checked = await call('validate_project', { changeSetId });
    expect(checked.data.some((f: { introduced: boolean }) => f.introduced)).toBe(true);
    expect(checked.hints?.join(' ')).toMatch(/introduced by change set/);
    await call('remove_items', { changeSetId, ids: ['svc.billing'] });

    // The baseline did not change; baseline + change set has the new parts.
    const disk = await onDisk();
    expect(disk.model).toEqual(baseline.model);
    expect(disk.changeSets[0]!.ops.length).toBeGreaterThan(4);
    const md = await call('get_architecture', { changeSetId });
    expect(md.data).toContain('wrk.mailer');
    expect((await call('get_architecture')).data).not.toContain('wrk.mailer');

    const tasks = await call('generate_tasks', { changeSetId });
    const titles = tasks.data.map((t: { title: string }) => t.title);
    expect(titles.indexOf('Create jobs.mail')).toBeLessThan(titles.indexOf('Create wrk.mailer'));
    expect(titles).toContain('Change svc.orders');
    const got = await call('get_change_set', { changeSetId });
    expect(got.data.ops[0]).toBe('Add wrk.mailer (node.worker)');
    expect(got.data.tasks).toHaveLength(titles.length);
    expect(got.data.conflicts).toEqual([]);
    expect(
      got.data.newFindings.some((f: { targetIds: string[] }) =>
        f.targetIds.includes('schema.orders'),
      ),
    ).toBe(false);

    const plan = await call('export', { format: 'plan-md', changeSetId, write: true });
    expect(plan.ok).toBe(true);
    const file = await readFile(join(ws.dir, 'plans', 'cs.send-receipts.md'), 'utf8');
    expect(file).toContain('# Plan: Send receipts');
    expect(file).toContain(
      '| ADD | svc.orders enqueues jobs.mail | receipt.send; inTransaction: true |',
    );
    expect((await onDisk()).changeSets[0]!.status).toBe('ready');
    const kiro = await call('export', { format: 'kiro', changeSetId, write: true });
    expect(kiro.data.written[0]).toBe(
      join(ws.dir, '..', '.kiro/specs/send-receipts/requirements.md'),
    );
    const resource = await client.readResource({
      uri: 'archguide://projects/shop/change-sets/cs.send-receipts',
    });
    expect((resource.contents[0] as { text: string }).text).toBe(file);

    // The agent built it: merge into the baseline.
    const done = await call('update_change_set', { changeSetId, status: 'implemented' });
    expect(done).toMatchObject({ ok: true, data: { status: 'implemented' } });
    const merged = await onDisk();
    expect(merged.model.elements.some((e) => e.id === 'wrk.mailer')).toBe(true);
    expect(merged.changeSets[0]!.status).toBe('implemented');
    expect(
      await call('upsert_elements', {
        changeSetId,
        elements: [{ kind: 'node.worker', name: 'X' }],
      }),
    ).toMatchObject({ ok: false, errors: [{ code: 'CHANGE_SET_CLOSED' }] });
  });

  it('lists conflicts when the baseline moves, and drops them', async () => {
    await call('create_change_set', { name: 'Audit', description: 'Audit log.' });
    await call('upsert_relations', {
      changeSetId: 'cs.audit',
      relations: [{ sourceId: 'svc.orders', targetId: 'schema.orders', type: 'reads' }],
    });
    await call('remove_items', { ids: ['schema.orders'] });
    const got = await call('get_change_set', { changeSetId: 'cs.audit' });
    expect(got.data.stale).toBe(true);
    // The relation, and its route in the view.
    expect(got.data.conflicts.map((c: { op: string }) => c.op)).toEqual([
      'Add svc.orders reads schema.orders',
      expect.stringMatching(/^Route rel\.svc-orders-reads-schema-orders/),
    ]);
    expect(got.hints?.[0]).toMatch(/no longer apply/);
    const refused = await call('update_change_set', {
      changeSetId: 'cs.audit',
      status: 'implemented',
    });
    expect(refused.ok).toBe(false);
    const fixed = await call('update_change_set', {
      changeSetId: 'cs.audit',
      dropOps: got.data.conflicts.map((c: { index: number }) => c.index),
      rebase: true,
    });
    expect(fixed.ok).toBe(true);
    expect((await call('get_change_set', { changeSetId: 'cs.audit' })).data).toMatchObject({
      stale: false,
      conflicts: [],
    });
  });
});

describe('MCP analysis tools', () => {
  beforeEach(async () => {
    // The workspace sits in a copy of a fixture repository, as after "archguide init".
    const repo = await mkdtemp(join(tmpdir(), 'archguide-mcp-repo-'));
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'analyzer',
      'fixtures',
      'pnpm-bff-pgboss',
    );
    await cp(fixture, repo, { recursive: true });
    await client.close();
    ws = new Workspace(join(repo, 'architecture'));
    await connect();
  });

  it('analyzes, applies, diffs and generates enforcement, only through MCP', async () => {
    const first = await call('analyze_repository');
    expect(first.ok).toBe(true);
    expect(first.data.candidates['node.service']).toBe(2);
    expect(first.hints?.[0]).toMatch(/create_project/);
    expect(
      first.data.elements.find((e: { name: string }) => e.name === 'Mailer').evidence[0],
    ).toMatch(/^workers\/mailer\//);

    await call('create_project', { name: 'Tickets' });
    // Without a workspace folder the first run was not saved: nothing to apply yet.
    expect(await call('apply_analysis')).toMatchObject({
      ok: false,
      errors: [{ code: 'NOT_FOUND' }],
    });
    await call('analyze_repository');
    const applied = await call('apply_analysis', { minConfidence: 0.6 });
    expect(applied.ok).toBe(true);
    expect(applied.data.applied).toBeGreaterThan(20);
    const p = await onDisk('tickets');
    expect(p.model.elements.find((e) => e.name === 'Mailer')?.source).toMatchObject({
      origin: 'inferred',
      reviewed: false,
    });
    // Applying again adds nothing: everything matches now.
    expect((await call('apply_analysis')).data.applied).toBe(0);

    const diff = await call('diff_with_repository');
    expect(diff.data).toMatchObject({ newInCode: [], missingInCode: [] });

    const gen = await call('generate_enforcement', { target: 'dependency-cruiser', write: true });
    expect(gen.data.written).toBe(join(ws.dir, '.archguide/dependency-cruiser.cjs'));
    expect(gen.data.rules).toContain('AG-RNP-003-no-db-client-in-app-web');
    const nx = await call('generate_enforcement', { target: 'nx' });
    expect(nx.data).toContain('depConstraints');

    // Code changes: a service goes away; the model still says it exists.
    await writeFile(
      join(ws.dir, '..', 'workers', 'mailer', 'package.json'),
      '{ "name": "@tickets/mailer" }',
    );
    const drift = await call('diff_with_repository');
    expect(drift.data.missingInCode.map((m: { name: string }) => m.name)).toContain('Mailer');
    expect(drift.data.findings.some((f: { ruleId: string }) => f.ruleId === 'DRIFT-001')).toBe(
      true,
    );
  });
});
