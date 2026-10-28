import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, defaultCatalog } from '@archguide/mcp-server';
import { Workspace, applyToWorkspace, readLock } from '@archguide/workspace';
import { main } from '.';

let cwd: string;
const ws = () => new Workspace(join(cwd, 'architecture'));

async function cli(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { cwd, out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'archguide-cli-'));
});

describe('archguide init', () => {
  it('creates the workspace, ARCHITECTURE.md, the skill and .gitignore lines, once', async () => {
    await writeFile(join(cwd, '.gitignore'), 'node_modules/');
    const first = await cli('init', '--template', 'T1', '--name', 'Shop');
    expect(first.code).toBe(0);
    expect(await ws().readConfig()).toMatchObject({
      defaultProject: 'shop',
      profile: 'react-node-postgres',
      exports: [{ format: 'agent-md', out: 'ARCHITECTURE.md' }],
    });
    expect((await ws().readProject('shop')).model.elements.length).toBeGreaterThan(2);
    expect(await readFile(join(cwd, 'architecture', 'ARCHITECTURE.md'), 'utf8')).toContain(
      'Shop API',
    );
    expect(await readFile(join(cwd, '.claude/skills/archguide/SKILL.md'), 'utf8')).toMatch(
      /^---\nname: archguide/,
    );
    const gitignore = await readFile(join(cwd, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(
      /^node_modules\/\n\n# ArchitectureGuide\narchitecture\/\.archguide\/analysis\//,
    );

    const again = await cli('init', '--json');
    expect(again.code).toBe(0);
    expect(JSON.parse(again.out)).toMatchObject({ projectId: 'shop', created: [] });
    expect(await readFile(join(cwd, '.gitignore'), 'utf8')).toBe(gitignore);
  });

  it('reports a bad template as a usage error', async () => {
    const r = await cli('init', '--template', 'T99', '--no-skill');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Unknown template "T99".*T1/);
  });
});

describe('commands on a workspace', () => {
  beforeEach(async () => {
    await cli('init', '--name', 'Shop', '--no-skill');
  });

  it('validate exits with 1 at --fail-on and prints JSON', async () => {
    const catalog = defaultCatalog();
    await applyToWorkspace(
      ws(),
      catalog,
      'shop',
      [
        {
          op: 'addElement',
          element: { id: 'svc.a', kind: 'node.service', name: 'A', status: 'planned' },
        },
        {
          op: 'addElement',
          element: { id: 'svc.b', kind: 'node.service', name: 'B', status: 'planned' },
        },
        {
          op: 'addElement',
          element: { id: 'db.main', kind: 'pg.database', name: 'Main', status: 'planned' },
        },
        {
          op: 'addRelation',
          relation: {
            id: 'rel.a',
            type: 'writes',
            sourceId: 'svc.a',
            targetId: 'db.main',
            status: 'planned',
          },
        },
        {
          op: 'addRelation',
          relation: {
            id: 'rel.b',
            type: 'writes',
            sourceId: 'svc.b',
            targetId: 'db.main',
            status: 'planned',
          },
        },
      ],
      { origin: 'cli' },
    );
    const text = await cli('validate', '--fail-on', 'info');
    expect(text.code).toBe(1);
    expect(text.out).toMatch(/db\.main/);
    const json = await cli('--json', 'validate', '--fail-on', 'error');
    const findings = (JSON.parse(json.out) as { findings: { severity: string }[] }).findings;
    expect(json.code).toBe(findings.some((f) => f.severity === 'error') ? 1 : 0);
    expect((await cli('validate', '--fail-on', 'fatal')).code).toBe(2);
  });

  it('exports to stdout, to the configured path and to --out', async () => {
    const md = await cli('export', 'agent-md');
    expect(md.out).toContain('# Architecture: Shop');
    expect((await cli('export', 'agent-md', '--write')).code).toBe(0);
    expect(await readFile(join(cwd, 'architecture', 'ARCHITECTURE.md'), 'utf8')).toBe(md.out);
    expect((await cli('export', 'dbml', '--out', '../docs/shop.dbml')).code).toBe(0);
    expect(await readFile(join(cwd, 'docs', 'shop.dbml'), 'utf8')).toBeTruthy();
    expect((await cli('export', 'pdf')).code).toBe(2);
    expect((await cli('--project', 'nope', 'export', 'json')).code).toBe(2);
  });

  it('validates and exports a change set with --change-set', async () => {
    const catalog = defaultCatalog();
    const base = await ws().readProject('shop');
    await applyToWorkspace(
      ws(),
      catalog,
      'shop',
      [
        {
          op: 'upsertChangeSet',
          changeSet: {
            id: 'cs.reports',
            name: 'Reports',
            description: 'Monthly reports.',
            status: 'draft',
            baseRevision: base.revision + 1,
            createdAt: '2026-10-28T00:00:00.000Z',
            ops: [
              {
                op: 'addElement',
                element: {
                  id: 'svc.reports',
                  kind: 'node.service',
                  name: 'Reports',
                  status: 'planned',
                },
              },
            ],
          },
        },
      ],
      { origin: 'cli' },
    );
    const v = await cli('--json', 'validate', '--change-set', 'cs.reports');
    const out = JSON.parse(v.out) as {
      changeSet: string;
      conflicts: unknown[];
      findings: { introduced: boolean }[];
    };
    expect(out.changeSet).toBe('cs.reports');
    expect(out.conflicts).toEqual([]);
    expect(out.findings.every((f) => typeof f.introduced === 'boolean')).toBe(true);
    expect((await cli('validate', '--change-set', 'cs.nope')).code).toBe(2);
    const md = await cli('export', 'agent-md', '--change-set', 'cs.reports');
    expect(md.out).toContain('svc.reports');
    expect((await cli('export', 'plan-md')).code).toBe(2);
    expect((await cli('export', 'plan-md', '--change-set', 'cs.reports', '--write')).code).toBe(0);
    const plan = await readFile(join(cwd, 'architecture', 'plans', 'cs.reports.md'), 'utf8');
    expect(plan).toContain('status: ready');
    expect(plan).toContain('**Create svc.reports**');
    expect((await ws().readProject('shop')).changeSets[0]!.status).toBe('ready');
    expect((await cli('export', 'speckit', '--change-set', 'cs.reports', '--write')).code).toBe(0);
    expect(await readFile(join(cwd, 'specs', '001-reports', 'tasks.md'), 'utf8')).toContain('T001');
  });

  it('explains, lists templates, writes onboarding, and migrates', async () => {
    expect((await cli('explain', 'react.client-store', '--level', 'beginner')).out).toContain(
      'Typical connections',
    );
    expect((await cli('explain', 'RNP-001')).out).toMatch(/^# RNP-001/);
    expect((await cli('explain', 'react.client-stor')).code).toBe(2);
    expect((await cli('templates')).out).toMatch(/T1\s+rnp\.starter/);
    expect((await cli('onboarding', '--level', 'senior')).code).toBe(0);
    expect(await readFile(join(cwd, 'architecture', 'ONBOARDING.md'), 'utf8')).toMatch(/^# /);
    expect(JSON.parse((await cli('--json', 'migrate', '--dry-run')).out)).toEqual([
      { file: 'shop.archguide.json', from: 1, to: 1, changed: false },
    ]);
    expect((await cli('generate', 'dependency-cruiser')).code).toBe(0);
  });

  it('needs a workspace', async () => {
    const r = await cli('--workspace', 'elsewhere', 'validate');
    expect(r).toMatchObject({ code: 2 });
    expect(r.err).toMatch(/archguide init/);
  });
});

describe('archguide serve with MCP', () => {
  it('routes MCP writes through the server, so a connected browser gets them live', async () => {
    await cli('init', '--name', 'Shop', '--no-skill');
    const stop = new AbortController();
    let out = '';
    const serving = main(['--json', 'serve', '--port', '0', '--no-watch'], {
      cwd,
      out: (t) => (out += t),
      err: () => {},
      signal: stop.signal,
    });
    for (let i = 0; i < 100 && !out; i++) await new Promise((r) => setTimeout(r, 20));
    const { port, token } = JSON.parse(out) as { port: number; token: string };
    expect(await readLock(ws())).toMatchObject({ port });

    const browser = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`);
    const messages: { t: string; origin?: string; revision?: number }[] = [];
    browser.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((r) => browser.once('open', r));
    browser.send(JSON.stringify({ t: 'hello', projectId: 'shop' }));

    const server = createMcpServer({ workspace: ws(), catalog: defaultCatalog(), readOnly: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const r = await client.callTool({
      name: 'upsert_elements',
      arguments: { elements: [{ kind: 'node.service', name: 'Orders API' }] },
    });
    expect(r.structuredContent).toMatchObject({ ok: true, revision: 1 });
    for (let i = 0; i < 100 && !messages.some((m) => m.t === 'ops'); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(messages.find((m) => m.t === 'ops')).toMatchObject({ origin: 'mcp', revision: 1 });

    await client.close();
    browser.close();
    stop.abort();
    expect(await serving).toBe(0);
    expect(await readLock(ws())).toBeUndefined();
  });
});

describe('analysis commands', () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'analyzer',
    'fixtures',
    'bad-practices',
  );
  beforeEach(async () => {
    await cp(fixture, cwd, { recursive: true });
    await cli('init', '--name', 'Bad', '--no-skill');
  });

  it('analyze drafts the model, saves last.json, and --write adds it as inferred', async () => {
    const dry = await cli('--json', 'analyze');
    const r = JSON.parse(dry.out) as {
      candidates: Record<string, number>;
      findings: unknown[];
      diff: { newInCode: string[] };
    };
    expect(r.candidates['node.service']).toBe(2);
    expect(r.diff.newInCode.length).toBeGreaterThan(10);
    expect(
      JSON.parse(await readFile(join(cwd, 'architecture/.archguide/analysis/last.json'), 'utf8')),
    ).toHaveProperty('candidates');
    expect((await ws().readProject('bad')).model.elements).toEqual([]);

    expect((await cli('analyze', '--write')).code).toBe(0);
    const p = await ws().readProject('bad');
    expect(p.model.elements.find((e) => e.name === 'Orders')).toMatchObject({
      kind: 'node.service',
      source: { origin: 'inferred', reviewed: false },
    });
    // Every new element is placed on the canvas.
    expect(p.views[0]!.nodes.length).toBe(p.model.elements.length);
    expect(JSON.parse((await cli('--json', 'drift')).out)).toMatchObject({
      newInCode: [],
      missingInCode: [],
    });
  });

  it('check fails with file and line, also as GitHub annotations; generate writes the config', async () => {
    await cli('analyze', '--write');
    const text = await cli('check');
    expect(text.code).toBe(1);
    expect(text.out).toMatch(
      /AG-RNP-003-no-db-client-in-app-web .*apps\/web\/src\/shared\/lib\/db\.ts:2/,
    );
    const gh = await cli('check', '--format', 'github');
    expect(gh.out).toMatch(
      /^::error file=apps\/web\/src\/shared\/lib\/db\.ts,line=2,title=AG-RNP-003-no-db-client-in-app-web::/m,
    );
    expect((await cli('check', '--fail-on', 'error', '--format', 'json')).code).toBe(1);

    const gen = await cli('--json', 'generate', 'dependency-cruiser');
    const written = JSON.parse(gen.out) as { written: string; rules: string[] };
    expect(written.written).toBe(join(cwd, 'architecture/.archguide/dependency-cruiser.cjs'));
    expect(await readFile(written.written, 'utf8')).toContain('module.exports');
    expect((await cli('generate', 'nx', '--stdout')).out).toContain('depConstraints');
    expect((await cli('generate', 'gradle')).code).toBe(2);
  });

  it('--db needs the database URL in the environment', async () => {
    delete process.env.ARCHGUIDE_DATABASE_URL_READONLY;
    const r = await cli('analyze', '--db');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/ARCHGUIDE_DATABASE_URL_READONLY/);
  });
});
