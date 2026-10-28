import { readFile, rm } from 'node:fs/promises';
import type { Workspace } from './workspace';
import { writeFileAtomic } from './workspace';

/**
 * The lock file of a running `archguide serve` (Implementation.md §14.5):
 * `architecture/.archguide/server.json`. While it exists and its process runs, the server is
 * the only writer; the CLI and MCP send their ops to it.
 */
export interface ServerLock {
  port: number;
  host: string;
  token: string;
  pid: number;
  url: string;
  startedAt: string;
}

const lockPath = (ws: Workspace) => ws.localPath('server.json');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The running server's lock, or undefined (no file, unreadable, or a dead process). */
export async function readLock(ws: Workspace): Promise<ServerLock | undefined> {
  try {
    const lock = JSON.parse(await readFile(lockPath(ws), 'utf8')) as ServerLock;
    return typeof lock.port === 'number' && typeof lock.token === 'string' && alive(lock.pid)
      ? lock
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeLock(ws: Workspace, lock: ServerLock): Promise<void> {
  await writeFileAtomic(lockPath(ws), `${JSON.stringify(lock, null, 2)}\n`);
}

export async function removeLock(ws: Workspace): Promise<void> {
  await rm(lockPath(ws), { force: true });
}
