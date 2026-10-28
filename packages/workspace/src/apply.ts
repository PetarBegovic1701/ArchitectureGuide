import { applyOps } from '@archguide/core';
import type { Catalog, Op, OpError, Project } from '@archguide/core';
import type { Workspace } from './workspace';
import { WorkspaceError, withFileLock } from './workspace';
import { readLock } from './lock';
import type { ServerLock } from './lock';

/** Where a change comes from; the browser shows it (§14.5). */
export type Origin = 'mcp' | 'cli' | 'client' | 'file';

export type ApplyResult =
  | { ok: true; project: Project; revision: number; via: 'server' | 'file' }
  | { ok: false; errors: OpError[] };

const conflict = (message: string): ApplyResult => ({
  ok: false,
  errors: [{ index: 0, code: 'REVISION_CONFLICT', message }],
});

/** Calls the running server's HTTP API. */
export async function serverRequest<T>(
  lock: ServerLock,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`http://${lock.host}:${lock.port}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${lock.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok && res.status !== 409 && res.status !== 422)
    throw new WorkspaceError(json.message ?? `The server answered ${res.status}.`);
  return json;
}

/**
 * Applies ops to a project (Implementation.md §14.5, §20.5). With a running server, the ops
 * go to it, so the open browser updates live. Without one, the file is read, the ops are
 * applied, and the file is written atomically with a revision check; when someone wrote the
 * file in between, the ops are applied again to the newer version.
 */
export async function applyToWorkspace(
  ws: Workspace,
  catalog: Catalog,
  projectId: string,
  ops: Op[],
  options: { origin: Origin; baseRevision?: number },
): Promise<ApplyResult> {
  const lock = await readLock(ws);
  if (lock) {
    const r = await serverRequest<ApplyResult & { project?: Project }>(
      lock,
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/ops`,
      { ops, origin: options.origin, baseRevision: options.baseRevision },
    );
    return r.ok ? { ...r, via: 'server' } : r;
  }
  // The lock makes read → apply → write one step for every writer that uses this package;
  // the revision check still catches writers that do not (the browser's folder mode).
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await withFileLock(
      ws.fileFor(projectId),
      async (): Promise<ApplyResult | undefined> => {
        // Ops made for an older revision are applied to the newest one; they stay valid in
        // most cases because they are small and ID-based (§14.5).
        const project = await ws.readProject(projectId);
        const applied = applyOps(project, ops, catalog);
        if (!applied.ok) return { ok: false, errors: applied.errors };
        const next: Project = {
          ...applied.project,
          revision: project.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        try {
          await ws.writeProject(next, { expectedRevision: project.revision });
          return { ok: true, project: next, revision: next.revision, via: 'file' };
        } catch (error) {
          if ((error as WorkspaceError).code !== 'REVISION_CONFLICT') throw error;
          return undefined;
        }
      },
    );
    if (result) return result;
  }
  return conflict(`${projectId} keeps changing on disk; try again.`);
}

/** Saves a new project, through the running server when there is one. */
export async function createInWorkspace(ws: Workspace, project: Project): Promise<void> {
  const lock = await readLock(ws);
  if (lock) {
    const r = await serverRequest<{ ok: boolean; message?: string }>(
      lock,
      'PUT',
      `/api/projects/${encodeURIComponent(project.id)}`,
      { project },
    );
    if (!r.ok) throw new WorkspaceError(r.message ?? `Could not create ${project.id}.`, 'EXISTS');
    return;
  }
  if ((await ws.listProjects()).some((p) => p.id === project.id))
    throw new WorkspaceError(`A project "${project.id}" already exists.`, 'EXISTS');
  await ws.writeProject(project);
}

/** Reads a project, from the running server when there is one (it may hold newer data). */
export async function readFromWorkspace(ws: Workspace, projectId: string): Promise<Project> {
  const lock = await readLock(ws);
  if (lock) {
    const r = await serverRequest<{ ok: boolean; project?: Project; message?: string }>(
      lock,
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
    if (r.ok && r.project) return r.project;
    throw new WorkspaceError(r.message ?? `There is no project "${projectId}".`, 'NOT_FOUND');
  }
  return ws.readProject(projectId);
}
