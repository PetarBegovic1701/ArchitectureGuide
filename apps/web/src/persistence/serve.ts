import { parseProject } from '@archguide/core';
import type {
  AnalysisResult,
  ChangeOrigin,
  ClientMessage,
  Id,
  Op,
  OpError,
  Project,
  ServerMessage,
} from '@archguide/core';

/**
 * Serve mode (Implementation.md §14.5): `archguide serve` opens the app with `?t=<token>`.
 * The server is the only writer of the files; the browser sends its ops over a WebSocket
 * and applies the ops of MCP, the CLI and other tabs live.
 */

const TOKEN_KEY = 'archguide.serve-token';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('t');
  try {
    if (fromUrl) {
      // Kept for this tab only, and taken out of the address bar so it is not shared by accident.
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.toString());
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return fromUrl;
  }
}

const token = readToken();

/** True when the app was opened by `archguide serve`. */
export const isServeMode = (): boolean => token !== null;

/** Projects that live in this browser even in serve mode (lesson projects). */
const browserOnly = new Set<Id>();

/** True when the server holds this project: it saves it and syncs it live. */
export const isServed = (projectId: Id | undefined): boolean =>
  isServeMode() && projectId !== undefined && !browserOnly.has(projectId);

/** Serve mode: marks a project that was found in the browser, not on the server. */
export const markBrowserOnly = (projectId: Id): void => void browserOnly.add(projectId);

export interface ServeProjectEntry {
  id: Id;
  name: string;
  revision: number;
  file: string;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(json.message ?? `The server answered ${res.status}.`);
  return json;
}

export const listServeProjects = async (): Promise<ServeProjectEntry[]> =>
  (await api<{ projects: ServeProjectEntry[] }>('/api/projects')).projects;

export const loadServeProject = async (id: Id): Promise<Project | undefined> => {
  try {
    return parseProject(
      (await api<{ project: unknown }>(`/api/projects/${encodeURIComponent(id)}`)).project,
    );
  } catch {
    return undefined;
  }
};

/** Fires when `archguide analyze` saved a new analysis (serve mode). */
export const analysisEvents = new EventTarget();

/** The last analysis (`.archguide/analysis/last.json`), or undefined when there is none. */
export const loadServeAnalysis = async (): Promise<AnalysisResult | undefined> => {
  try {
    return (await api<{ analysis: AnalysisResult }>('/api/analysis')).analysis;
  } catch {
    return undefined;
  }
};

/** Remembers rejected suggestions, so the next analysis does not offer them again. */
export const rejectServeSubjects = async (subjects: string[]): Promise<void> => {
  await api('/api/analysis/rejected', { method: 'POST', body: JSON.stringify({ subjects }) });
};

export const createServeProject = async (project: Project): Promise<void> => {
  await api(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ project }),
  });
};

const socketUrl = () => {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('t', token ?? '');
  return url.toString();
};

/** Notifies when the server's project list changes (`projects` messages). */
export function watchServeProjects(onChange: () => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    socket = new WebSocket(socketUrl());
    socket.onmessage = (e) => {
      if ((JSON.parse(String(e.data)) as ServerMessage).t === 'projects') onChange();
    };
    socket.onclose = () => {
      if (!closed) retry = setTimeout(open, 1000);
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}

export type SyncStatus = 'connecting' | 'live' | 'offline';

export interface SyncState {
  status: SyncStatus;
  /** Ops sent and not acknowledged yet. */
  pending: number;
  /** The file changed outside the app while changes of this tab were not saved yet. */
  conflict: { project: Project; ops: Op[] } | null;
  /** Who made the last change that came in from outside this tab. */
  lastRemote: { origin: ChangeOrigin; at: number } | null;
}

/** What the sync needs from the editor's store. */
export interface SyncTarget {
  current(): Project | null;
  /** Applies ops from MCP, the CLI or another tab; not an undo step. Returns false if they do not apply. */
  applyRemote(ops: Op[], revision: number): boolean;
  /** Replaces the project with the server's version. */
  replaceRemote(project: Project): void;
  setRevision(revision: number): void;
  rejected(errors: OpError[]): void;
}

interface Sent {
  clientOpId: string;
  ops: Op[];
}

/** One open project in serve mode. */
export class ServeSync {
  private socket: WebSocket | null = null;
  private sent: Sent[] = [];
  private revision = 0;
  private counter = 0;
  private closed = false;
  /** The next `state` replaces this tab's copy, even at the same revision. */
  private resyncing = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snapshot: SyncState = {
    status: 'connecting',
    pending: 0,
    conflict: null,
    lastRemote: null,
  };

  constructor(
    private readonly projectId: Id,
    private readonly target: SyncTarget,
  ) {
    this.revision = target.current()?.revision ?? 0;
    this.open();
  }

  get state(): SyncState {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends ops the user made in this tab. */
  send(ops: Op[]): void {
    if (ops.length === 0) return;
    const clientOpId = `${Date.now().toString(36)}-${(this.counter++).toString(36)}`;
    this.sent.push({ clientOpId, ops });
    this.post({
      t: 'ops',
      projectId: this.projectId,
      baseRevision: this.revision,
      ops,
      clientOpId,
    });
    this.update({ pending: this.sent.length });
  }

  /** Conflict: take the file's version and send this tab's changes again on top of it. */
  reapply(): void {
    const conflict = this.snapshot.conflict;
    if (!conflict) return;
    this.resolve(conflict.project);
    if (this.target.applyRemote(conflict.ops, conflict.project.revision)) this.send(conflict.ops);
    else
      this.target.rejected([
        {
          index: 0,
          code: 'REVISION_CONFLICT',
          message: 'Your changes no longer fit the changed file, so they were dropped.',
        },
      ]);
  }

  /** Conflict: take the file's version and drop this tab's unsaved changes. */
  discard(): void {
    const conflict = this.snapshot.conflict;
    if (conflict) this.resolve(conflict.project);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.listeners.clear();
  }

  private resolve(project: Project) {
    this.target.replaceRemote(project);
    this.revision = project.revision;
    this.update({ conflict: null });
    // Tells the server this tab now has the new version, so it takes its ops again.
    this.post({ t: 'hello', projectId: this.projectId });
  }

  private open() {
    const socket = new WebSocket(socketUrl());
    this.socket = socket;
    socket.onopen = () => this.post({ t: 'hello', projectId: this.projectId });
    socket.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMessage);
    socket.onclose = () => {
      if (this.socket !== socket || this.closed) return;
      this.update({ status: 'offline' });
      this.retry = setTimeout(() => this.open(), 1000);
    };
  }

  private post(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(m: ServerMessage) {
    switch (m.t) {
      case 'state': {
        const external = m.origin === 'file';
        if (external && this.sent.length > 0) {
          // The server refuses the unsaved ops of this tab until the user decides (§14.5).
          const ops = [...(this.snapshot.conflict?.ops ?? []), ...this.sent.flatMap((s) => s.ops)];
          this.sent = [];
          this.update({ conflict: { project: m.project, ops }, pending: 0, status: 'live' });
          return;
        }
        if (this.snapshot.conflict) {
          this.update({
            conflict: { ...this.snapshot.conflict, project: m.project },
            status: 'live',
          });
          return;
        }
        const current = this.target.current();
        if (
          this.resyncing ||
          external ||
          !current ||
          current.revision !== m.project.revision ||
          current.updatedAt !== m.project.updatedAt
        )
          this.target.replaceRemote(m.project);
        this.resyncing = false;
        this.revision = m.project.revision;
        this.update({
          status: 'live',
          ...(external ? { lastRemote: { origin: 'file', at: Date.now() } } : {}),
        });
        if (external) this.post({ t: 'hello', projectId: this.projectId });
        return;
      }
      case 'ops': {
        if (this.snapshot.conflict) return;
        this.revision = Math.max(this.revision, m.revision);
        // Our copy no longer matches: get the server's version.
        if (!this.target.applyRemote(m.ops, m.revision)) this.resync();
        this.update({ lastRemote: { origin: m.origin, at: Date.now() } });
        return;
      }
      case 'applied': {
        this.sent = this.sent.filter((s) => s.clientOpId !== m.clientOpId);
        this.revision = Math.max(this.revision, m.revision);
        this.target.setRevision(this.revision);
        this.update({ pending: this.sent.length });
        return;
      }
      case 'rejected': {
        const ops = this.sent.find((s) => s.clientOpId === m.clientOpId)?.ops ?? [];
        this.sent = this.sent.filter((s) => s.clientOpId !== m.clientOpId);
        this.update({ pending: this.sent.length });
        if (this.snapshot.conflict) {
          // Refused because of the reload: they wait in the conflict until the user decides.
          if (m.errors[0]?.code === 'REVISION_CONFLICT')
            this.update({
              conflict: { ...this.snapshot.conflict, ops: [...this.snapshot.conflict.ops, ...ops] },
            });
          return;
        }
        this.target.rejected(m.errors);
        this.resync();
        return;
      }
      case 'error':
        this.target.rejected([{ index: 0, code: 'SCHEMA_INVALID', message: m.message }]);
        return;
      case 'analysis':
        analysisEvents.dispatchEvent(new Event('change'));
        return;
      case 'projects':
        return;
    }
  }

  private resync() {
    this.resyncing = true;
    this.post({ t: 'hello', projectId: this.projectId });
  }

  private update(patch: Partial<SyncState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}
