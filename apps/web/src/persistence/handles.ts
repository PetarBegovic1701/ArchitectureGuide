import { db } from './db';
import { folder } from './folder';
import type { DirectoryLike } from './folder';

/** The File System Access entry points this app uses (Chromium only). */
interface FolderWindow {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }): Promise<FileSystemDirectoryHandle>;
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermissionState>;
};

const LAST = 'last-folder';

/** Asks the user for a folder, opens it, and remembers it for next time. */
export async function pickFolder(): Promise<void> {
  const handle = await (window as unknown as FolderWindow).showDirectoryPicker({
    id: 'archguide',
    mode: 'readwrite',
  });
  await folder.open(handle as unknown as DirectoryLike);
  if (!(await isPrivateFolder(handle)))
    await db.handles.put({
      id: LAST,
      name: handle.name,
      handle,
      openedAt: new Date().toISOString(),
    });
}

/**
 * Whether a folder is inside the browser's private file system (OPFS). Such folders do not
 * come from the folder picker; tests use them. They are not remembered, because some
 * Chromium builds crash when reading an OPFS handle back from IndexedDB.
 */
async function isPrivateFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await (await navigator.storage.getDirectory()).resolve(handle)) !== null;
  } catch {
    return false;
  }
}

/** The folder opened last time, if the browser still has it. */
export async function lastFolder(): Promise<{ name: string } | undefined> {
  const row = await db.handles.get(LAST);
  return row ? { name: row.name } : undefined;
}

/** Reopens the last folder. Must run from a click: the browser asks for permission again. */
export async function reopenFolder(): Promise<void> {
  const row = await db.handles.get(LAST);
  if (!row) throw new Error('No folder was opened before.');
  const handle = row.handle as PermissionHandle;
  const state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (
    state !== 'granted' &&
    (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted'
  )
    throw new Error(`Permission to use the folder “${row.name}” was not given.`);
  await folder.open(handle as unknown as DirectoryLike);
  await db.handles.put({ ...row, openedAt: new Date().toISOString() });
}

export function closeFolder(): void {
  folder.close();
}
