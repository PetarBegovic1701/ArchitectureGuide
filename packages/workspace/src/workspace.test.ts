import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCatalog, createProject } from '@archguide/core';
import type { Op } from '@archguide/core';
import {
  Workspace,
  WorkspaceError,
  applyToWorkspace,
  createInWorkspace,
  readLock,
  removeLock,
  writeLock,
} from '.';

const catalog = createCatalog();
const NOW = '2026-10-28T00:00:00.000Z';
const addActor = (id: string): Op => ({
  op: 'addElement',
  element: { id, kind: 'gen.actor', name: id, status: 'planned' },
});

let ws: Workspace;
beforeEach(async () => {
  ws = new Workspace(join(await mkdtemp(join(tmpdir(), 'archguide-')), 'architecture'));
});

describe('Workspace', () => {
  it('creates, lists and reads projects; leaves no temporary files', async () => {
    expect(await ws.listProjects()).toEqual([]);
    await createInWorkspace(
      ws,
      createProject({ id: 'shop', name: 'Shop', profile: 'x', now: NOW }),
    );
    expect(await ws.listProjects()).toEqual([
      { id: 'shop', name: 'Shop', revision: 0, file: 'shop.archguide.json' },
    ]);
    expect((await ws.readProject('shop')).name).toBe('Shop');
    expect((await readdir(ws.dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await expect(
      createInWorkspace(ws, createProject({ id: 'shop', name: 'Again', profile: 'x', now: NOW })),
    ).rejects.toMatchObject({ code: 'EXISTS' });
  });

  it('reports missing and broken files, and finds the default project', async () => {
    await expect(ws.readProject('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await ws.writeConfig({ defaultProject: 'shop' });
    expect(await ws.resolveProjectId()).toBe('shop');
    expect(await ws.resolveProjectId('other')).toBe('other');
    await writeFile(ws.fileFor('broken'), '{ not json');
    await expect(ws.readProject('broken')).rejects.toBeInstanceOf(WorkspaceError);
    // Broken files are skipped in the list.
    expect(await ws.listProjects()).toEqual([]);
  });

  it('refuses a write when the file changed since it was read', async () => {
    const p = createProject({ id: 'shop', name: 'Shop', profile: 'x', now: NOW });
    await ws.writeProject(p);
    await ws.writeProject({ ...p, revision: 1 }, { expectedRevision: 0 });
    await expect(
      ws.writeProject({ ...p, revision: 2 }, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
});

describe('applyToWorkspace without a server', () => {
  beforeEach(async () => {
    await createInWorkspace(
      ws,
      createProject({ id: 'shop', name: 'Shop', profile: 'x', now: NOW }),
    );
  });

  it('applies ops, bumps the revision and writes the file', async () => {
    const r = await applyToWorkspace(ws, catalog, 'shop', [addActor('actor.a')], { origin: 'cli' });
    expect(r).toMatchObject({ ok: true, revision: 1, via: 'file' });
    expect((await ws.readProject('shop')).model.elements.map((e) => e.id)).toEqual(['actor.a']);
  });

  it('returns op errors and leaves the file alone', async () => {
    const r = await applyToWorkspace(ws, catalog, 'shop', [{ op: 'removeElement', id: 'nope' }], {
      origin: 'mcp',
    });
    expect(r).toMatchObject({ ok: false, errors: [{ code: 'ID_NOT_FOUND' }] });
    expect((await ws.readProject('shop')).revision).toBe(0);
  });

  it('two writers at once: the second applies its ops to the newer revision', async () => {
    const [a, b] = await Promise.all([
      applyToWorkspace(ws, catalog, 'shop', [addActor('actor.a')], { origin: 'cli' }),
      applyToWorkspace(ws, catalog, 'shop', [addActor('actor.b')], { origin: 'mcp' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const p = await ws.readProject('shop');
    expect(p.revision).toBe(2);
    expect(p.model.elements.map((e) => e.id).sort()).toEqual(['actor.a', 'actor.b']);
  });
});

describe('lock file', () => {
  it('is ignored when its process is gone', async () => {
    expect(await readLock(ws)).toBeUndefined();
    const lock = { port: 4317, host: '127.0.0.1', token: 't', url: 'http://x', startedAt: NOW };
    await writeLock(ws, { ...lock, pid: process.pid });
    expect(await readLock(ws)).toMatchObject({ port: 4317 });
    await writeLock(ws, { ...lock, pid: 2 ** 22 + 12345 });
    expect(await readLock(ws)).toBeUndefined();
    await removeLock(ws);
    expect(await readLock(ws)).toBeUndefined();
  });
});
