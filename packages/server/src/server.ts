import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import { watch } from 'chokidar';
import { applyOps, parseProject, serializeProject } from '@archguide/core';
import type { Catalog, Op, OpError, Project } from '@archguide/core';
import {
  PROJECT_SUFFIX,
  WorkspaceError,
  readLock,
  removeLock,
  withFileLock,
  writeLock,
} from '@archguide/workspace';
import type { Workspace } from '@archguide/workspace';
import type { ChangeOrigin, ClientMessage, ServerMessage } from './protocol';

export interface ServeOptions {
  workspace: Workspace;
  /** Core concepts plus the profiles the caller registers (Implementation.md §4.1). */
  catalog: Catalog;
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  token?: string;
  /** The built web app (apps/web/dist). Without it, only the API runs. */
  webRoot?: string;
  /** Watch the files for changes made outside the server (git checkout, an editor). */
  watch?: boolean;
  log?: (message: string) => void;
}

export interface RunningServer {
  url: string;
  host: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

type ApplyOutcome = { ok: true; project: Project } | { ok: false; errors: OpError[] };

/**
 * `archguide serve` (Implementation.md §14.5): serves the web app, keeps projects in memory,
 * applies ops from the browser (WebSocket), the CLI and MCP (HTTP) one at a time per
 * project, writes the files atomically, broadcasts every change, and reloads files that
 * change on disk. A lock file tells the CLI and MCP to send their ops here.
 */
export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const { workspace: ws, catalog } = options;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(18).toString('base64url');
  const log = options.log ?? (() => {});

  const running = await readLock(ws);
  if (running)
    throw new WorkspaceError(`archguide serve already runs for this workspace: ${running.url}`);

  const cache = new Map<string, Project>();
  const queues = new Map<string, Promise<unknown>>();
  const subscribers = new Map<string, Set<WebSocket>>();
  const sockets = new Set<WebSocket>();
  /**
   * Browsers that were sent a reloaded file and have not answered with `hello` yet. Their
   * ops were made for the old version, so they are refused until the user chooses to
   * reapply or discard them (§14.5).
   */
  const stale = new Set<WebSocket>();

  const load = async (id: string): Promise<Project> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const p = await ws.readProject(id);
    cache.set(id, p);
    return p;
  };
  /** Runs changes of one project one after another. */
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).then(work, work);
    queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  };
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const broadcast = (projectId: string | null, message: ServerMessage, except?: WebSocket) => {
    const targets = projectId ? (subscribers.get(projectId) ?? new Set()) : sockets;
    for (const s of targets) if (s !== except) send(s, message);
  };
  /** A project was reloaded from disk: every open browser gets the new state. */
  const reloaded = (projectId: string, project: Project) => {
    for (const s of subscribers.get(projectId) ?? []) stale.add(s);
    broadcast(projectId, { t: 'state', project, origin: 'file' });
  };

  const apply = (
    projectId: string,
    ops: Op[],
    origin: ChangeOrigin,
    sender?: WebSocket,
  ): Promise<ApplyOutcome> =>
    serial(projectId, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (sender && stale.has(sender))
          return {
            ok: false,
            errors: [
              {
                index: 0,
                code: 'REVISION_CONFLICT',
                message: 'The file changed outside the app after these changes were made.',
              },
            ],
          };
        let project: Project;
        try {
          project = await load(projectId);
        } catch (error) {
          return {
            ok: false,
            errors: [{ index: 0, code: 'ID_NOT_FOUND', message: (error as Error).message }],
          };
        }
        const result = applyOps(project, ops, catalog);
        if (!result.ok) return { ok: false, errors: result.errors };
        const next: Project = {
          ...result.project,
          revision: project.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        const written = await withFileLock(ws.fileFor(projectId), async () => {
          // The file changed outside the server, and the watcher has not reported it yet:
          // reload it and apply the ops to that version instead of overwriting it.
          const onDisk = await readFile(ws.fileFor(projectId), 'utf8').catch(() => undefined);
          if (onDisk !== undefined && onDisk !== serializeProject(project)) return false;
          await ws.writeProject(next);
          return true;
        });
        if (!written) {
          cache.delete(projectId);
          reloaded(projectId, await load(projectId));
          continue;
        }
        cache.set(projectId, next);
        broadcast(projectId, { t: 'ops', projectId, revision: next.revision, ops, origin }, sender);
        log(`${origin}: ${ops.length} op(s) on ${projectId} → revision ${next.revision}`);
        return { ok: true, project: next };
      }
      return {
        ok: false,
        errors: [
          { index: 0, code: 'REVISION_CONFLICT', message: `${projectId} keeps changing on disk.` },
        ],
      };
    });

  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(fastifyWebsocket);

  const authorized = (headers: Record<string, unknown>, query: Record<string, unknown>) =>
    headers.authorization === `Bearer ${token}` ||
    headers['x-archguide-token'] === token ||
    query.t === token;

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path === '/api/health') return;
    if (!authorized(req.headers, req.query as Record<string, unknown>))
      return reply.code(401).send({ ok: false, message: 'Missing or wrong session token.' });
  });

  app.get('/api/health', async () => ({ ok: true, app: 'archguide' }));

  app.get('/api/projects', async () => ({ ok: true, projects: await ws.listProjects() }));

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    try {
      return { ok: true, project: await serial(req.params.id, () => load(req.params.id)) };
    } catch (error) {
      return reply.code(404).send({ ok: false, message: (error as Error).message });
    }
  });

  app.put<{ Params: { id: string }; Body: { project: unknown } }>(
    '/api/projects/:id',
    async (req, reply) => {
      let project: Project;
      try {
        project = parseProject(JSON.stringify(req.body?.project ?? null));
      } catch (error) {
        return reply.code(400).send({ ok: false, message: (error as Error).message });
      }
      if (project.id !== req.params.id)
        return reply
          .code(400)
          .send({ ok: false, message: 'The project ID does not match the URL.' });
      return serial(project.id, async () => {
        if ((await ws.listProjects()).some((p) => p.id === project.id))
          return reply
            .code(409)
            .send({ ok: false, message: `A project "${project.id}" already exists.` });
        await ws.writeProject(project);
        cache.set(project.id, project);
        broadcast(null, { t: 'projects' });
        return { ok: true, revision: project.revision };
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { ops: Op[]; origin?: ChangeOrigin; baseRevision?: number };
  }>('/api/projects/:id/ops', async (req, reply) => {
    const ops = req.body?.ops;
    if (!Array.isArray(ops))
      return reply.code(400).send({ ok: false, message: 'Send { ops: Op[] }.' });
    const origin = req.body.origin === 'cli' ? 'cli' : 'mcp';
    const r = await apply(req.params.id, ops, origin);
    if (!r.ok) return reply.code(422).send(r);
    return { ok: true, revision: r.project.revision, project: r.project };
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!authorized({}, req.query as Record<string, unknown>)) {
      socket.close(4401, 'token');
      return;
    }
    sockets.add(socket);
    let projectId: string | null = null;
    socket.on('message', async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(socket, { t: 'error', message: 'Not JSON.' });
      }
      if (msg.t === 'hello') {
        if (projectId) subscribers.get(projectId)?.delete(socket);
        projectId = msg.projectId;
        if (!subscribers.has(projectId)) subscribers.set(projectId, new Set());
        subscribers.get(projectId)!.add(socket);
        try {
          // In the queue, so a reload queued before this hello still marks the socket stale.
          const project = await serial(projectId, async () => {
            stale.delete(socket);
            return load(msg.projectId);
          });
          send(socket, { t: 'state', project });
        } catch (error) {
          send(socket, { t: 'error', message: (error as Error).message });
        }
      } else if (msg.t === 'ops') {
        const r = await apply(msg.projectId, msg.ops, 'client', socket);
        send(
          socket,
          r.ok
            ? { t: 'applied', clientOpId: msg.clientOpId, revision: r.project.revision }
            : { t: 'rejected', clientOpId: msg.clientOpId, errors: r.errors },
        );
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      stale.delete(socket);
      if (projectId) subscribers.get(projectId)?.delete(socket);
    });
  });

  if (options.webRoot) {
    await stat(join(options.webRoot, 'index.html')).catch(() => {
      throw new WorkspaceError(`No built web app in ${options.webRoot} (index.html is missing).`);
    });
    await app.register(fastifyStatic, { root: options.webRoot, prefix: '/' });
  }

  // Changes made outside the server: reload and tell the browsers (§14.5).
  const pending = new Map<string, NodeJS.Timeout>();
  const watcher =
    options.watch === false
      ? undefined
      : watch(ws.dir, {
          ignoreInitial: true,
          depth: 0,
          ignored: (path: string) => path.endsWith('.tmp') || path.endsWith('.lock'),
        });
  const fileChanged = (path: string) => {
    if (!path.endsWith(PROJECT_SUFFIX)) return;
    clearTimeout(pending.get(path));
    pending.set(
      path,
      setTimeout(() => {
        pending.delete(path);
        const id = basename(path, PROJECT_SUFFIX);
        void serial(id, async () => {
          let text: string;
          try {
            text = await readFile(path, 'utf8');
          } catch {
            cache.delete(id);
            broadcast(null, { t: 'projects' });
            return;
          }
          const cached = cache.get(id);
          // Our own writes come back as change events: nothing to do.
          if (cached && serializeProject(cached) === text) return;
          try {
            const project = parseProject(text);
            cache.set(id, project);
            reloaded(id, project);
            if (!cached) broadcast(null, { t: 'projects' });
            log(`file: ${id} changed on disk → reloaded`);
          } catch (error) {
            log(
              `file: ${id} is not a valid project (${(error as Error).message}); kept the last good version`,
            );
          }
        });
      }, 60),
    );
  };
  watcher?.on('change', fileChanged).on('add', fileChanged).on('unlink', fileChanged);
  if (watcher) await new Promise<void>((r) => watcher.once('ready', () => r()));

  try {
    await app.listen({ host, port: options.port ?? 4317 });
  } catch (error) {
    // For example EADDRINUSE: stop the watcher too, or the process never exits.
    for (const t of pending.values()) clearTimeout(t);
    await watcher?.close();
    await app.close();
    throw error;
  }
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 4317);
  const url = `http://${host}:${port}/?t=${token}`;
  await writeLock(ws, {
    port,
    host,
    token,
    pid: process.pid,
    url,
    startedAt: new Date().toISOString(),
  });

  return {
    url,
    host,
    port,
    token,
    async close() {
      for (const t of pending.values()) clearTimeout(t);
      await watcher?.close();
      for (const s of sockets) s.close(1001, 'server stopped');
      await app.close();
      await removeLock(ws);
    },
  };
}
