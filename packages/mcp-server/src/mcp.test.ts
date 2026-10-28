import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(prompts.map((p) => p.name)).toEqual(['plan-feature']);
    const p = await client.getPrompt({ name: 'plan-feature', arguments: { feature: 'Refunds' } });
    expect((p.messages[0]!.content as { text: string }).text).toContain('Refunds');
  });
});
