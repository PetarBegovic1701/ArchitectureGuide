import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createCatalog, createProject, serializeProject } from '@archguide/core';
import type { Op, Project } from '@archguide/core';
import { Workspace, applyToWorkspace, readLock } from '@archguide/workspace';
import { startServer } from '.';
import type { RunningServer, ServerMessage } from '.';

const catalog = createCatalog();
const NOW = '2026-10-28T00:00:00.000Z';
const actor = (id: string): Op => ({
  op: 'addElement',
  element: { id, kind: 'gen.actor', name: id, status: 'planned' },
});

let ws: Workspace;
let server: RunningServer;
let clients: WebSocket[] = [];

async function start(options: { watch?: boolean } = {}) {
  ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-serve-')), 'architecture'));
  await ws.writeProject(createProject({ id: 'shop', name: 'Shop', profile: 'x', now: NOW }));
  server = await startServer({ workspace: ws, catalog, port: 0, ...options });
}

const api = (path: string, init: RequestInit = {}, token = server.token) =>
  fetch(`http://127.0.0.1:${server.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

/** A WebSocket client that collects messages and waits for the next one that matches. */
async function connect(projectId = 'shop') {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?t=${server.token}`);
  clients.push(socket);
  const inbox: ServerMessage[] = [];
  const waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  socket.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as ServerMessage;
    const w = waiters.find((x) => x.match(m));
    if (w) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    } else inbox.push(m);
  });
  await new Promise((r) => socket.once('open', r));
  const next = <T extends ServerMessage['t']>(t: T, timeout = 3000) =>
    new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return resolve(inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>);
      const timer = setTimeout(() => reject(new Error(`no "${t}" message`)), timeout);
      waiters.push({
        match: (m) => m.t === t,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  socket.send(JSON.stringify({ t: 'hello', projectId }));
  const state = await next('state');
  return { socket, next, state: state.project };
}

afterEach(async () => {
  for (const c of clients) c.close();
  clients = [];
  await server?.close();
});

describe('archguide serve', () => {
  beforeEach(() => start());

  it('needs the session token for the API, writes a lock file, and lists projects', async () => {
    expect((await api('/api/health', {}, 'wrong')).status).toBe(200);
    expect((await api('/api/projects', {}, 'wrong')).status).toBe(401);
    const list = (await (await api('/api/projects')).json()) as { projects: { id: string }[] };
    expect(list.projects.map((p) => p.id)).toEqual(['shop']);
    expect(await readLock(ws)).toMatchObject({ port: server.port, token: server.token });
  });

  it('creates projects once, and tells every browser', async () => {
    const browser = await connect();
    const body = JSON.stringify({
      project: createProject({ id: 'blog', name: 'Blog', profile: 'x', now: NOW }),
    });
    expect((await api('/api/projects/blog', { method: 'PUT', body })).status).toBe(200);
    await browser.next('projects');
    expect((await api('/api/projects/blog', { method: 'PUT', body })).status).toBe(409);
    expect((await ws.readProject('blog')).name).toBe('Blog');
  });

  it('applies browser ops, acknowledges them, and broadcasts to the other tabs', async () => {
    const a = await connect();
    const b = await connect();
    a.socket.send(
      JSON.stringify({
        t: 'ops',
        projectId: 'shop',
        baseRevision: 0,
        ops: [actor('actor.a')],
        clientOpId: 'c1',
      }),
    );
    expect(await a.next('applied')).toEqual({ t: 'applied', clientOpId: 'c1', revision: 1 });
    expect(await b.next('ops')).toMatchObject({
      revision: 1,
      origin: 'client',
      ops: [actor('actor.a')],
    });
    expect((await ws.readProject('shop')).revision).toBe(1);

    a.socket.send(
      JSON.stringify({
        t: 'ops',
        projectId: 'shop',
        baseRevision: 1,
        ops: [{ op: 'removeElement', id: 'nope' }],
        clientOpId: 'c2',
      }),
    );
    expect(await a.next('rejected')).toMatchObject({
      clientOpId: 'c2',
      errors: [{ code: 'ID_NOT_FOUND' }],
    });
  });

  it('takes ops from MCP and the CLI over HTTP, and the browser sees them live', async () => {
    const browser = await connect();
    const res = await api('/api/projects/shop/ops', {
      method: 'POST',
      body: JSON.stringify({ ops: [actor('actor.m')], origin: 'mcp' }),
    });
    expect(await res.json()).toMatchObject({ ok: true, revision: 1 });
    expect(await browser.next('ops')).toMatchObject({ origin: 'mcp', revision: 1 });

    // The workspace package finds the lock file and goes through the server.
    const r = await applyToWorkspace(ws, catalog, 'shop', [actor('actor.c')], { origin: 'cli' });
    expect(r).toMatchObject({ ok: true, via: 'server', revision: 2 });
    expect(await browser.next('ops')).toMatchObject({ origin: 'cli', revision: 2 });

    const bad = await api('/api/projects/shop/ops', {
      method: 'POST',
      body: JSON.stringify({ ops: [actor('actor.m')] }),
    });
    expect(bad.status).toBe(422);
  });

  it('reloads a file changed outside the server and sends the new state', async () => {
    const browser = await connect();
    const project = await ws.readProject('shop');
    const edited: Project = { ...project, name: 'Shop (edited in git)', revision: 7 };
    await writeFile(ws.fileFor('shop'), serializeProject(edited));
    const state = await browser.next('state', 5000);
    expect(state).toMatchObject({
      origin: 'file',
      project: { name: 'Shop (edited in git)', revision: 7 },
    });
  });

  it('refuses browser ops made before a reload until the browser says hello again', async () => {
    const browser = await connect();
    const project = await ws.readProject('shop');
    await writeFile(ws.fileFor('shop'), serializeProject({ ...project, name: 'From git' }));
    await browser.next('state', 5000);
    const send = (clientOpId: string, id: string) =>
      browser.socket.send(
        JSON.stringify({
          t: 'ops',
          projectId: 'shop',
          baseRevision: 0,
          ops: [actor(id)],
          clientOpId,
        }),
      );
    send('c1', 'actor.late');
    expect(await browser.next('rejected')).toMatchObject({
      clientOpId: 'c1',
      errors: [{ code: 'REVISION_CONFLICT' }],
    });
    browser.socket.send(JSON.stringify({ t: 'hello', projectId: 'shop' }));
    expect((await browser.next('state')).project.name).toBe('From git');
    send('c2', 'actor.reapplied');
    expect(await browser.next('applied')).toMatchObject({ clientOpId: 'c2', revision: 1 });
    // MCP and the CLI re-read before they write, so their ops are never stale.
    const r = await applyToWorkspace(ws, catalog, 'shop', [actor('actor.m')], { origin: 'mcp' });
    expect(r).toMatchObject({ ok: true, revision: 2 });
  });

  it('cleans up when the port is taken, so the process can exit', async () => {
    const other = new Workspace(
      join(await mkdtemp(join(tmpdir(), 'archguide-port-')), 'architecture'),
    );
    await expect(startServer({ workspace: other, catalog, port: server.port })).rejects.toThrow(
      /EADDRINUSE/,
    );
    expect(await readLock(other)).toBeUndefined();
  });

  it('refuses to start twice for one workspace, and removes the lock when it stops', async () => {
    await expect(startServer({ workspace: ws, catalog, port: 0 })).rejects.toThrow(/already runs/);
    await server.close();
    expect(await readLock(ws)).toBeUndefined();
    server = await startServer({ workspace: ws, catalog, port: 0 });
  });
});

describe('external edits the watcher has not seen yet', () => {
  beforeEach(() => start({ watch: false }));

  it('are reloaded before the next write instead of being overwritten', async () => {
    const browser = await connect();
    const project = await ws.readProject('shop');
    await writeFile(
      ws.fileFor('shop'),
      serializeProject({ ...project, name: 'Renamed outside', revision: 3 }),
    );
    const res = await api('/api/projects/shop/ops', {
      method: 'POST',
      body: JSON.stringify({ ops: [actor('actor.x')], origin: 'mcp' }),
    });
    expect(await res.json()).toMatchObject({ ok: true, revision: 4 });
    expect(await browser.next('state')).toMatchObject({ origin: 'file' });
    const saved = JSON.parse(await readFile(ws.fileFor('shop'), 'utf8')) as Project;
    expect(saved.name).toBe('Renamed outside');
    expect(saved.model.elements.map((e) => e.id)).toEqual(['actor.x']);
  });
});
