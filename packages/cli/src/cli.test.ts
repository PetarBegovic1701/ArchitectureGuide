import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect((await cli('generate', 'dependency-cruiser')).code).toBe(2);
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
