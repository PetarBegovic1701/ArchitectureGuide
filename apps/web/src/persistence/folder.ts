import { parseProject, serializeProject } from '@archguide/core';
import type { Project } from '@archguide/core';

/**
 * Folder mode (Implementation.md §7.5, §14.1): projects live as files in a folder on disk,
 * opened with the File System Access API (Chromium). IndexedDB stays the working copy;
 * every save also writes the file.
 *
 * ```
 * architecture/
 * ├─ archguide.config.json
 * ├─ shop.archguide.json
 * └─ .archguide/snapshots/shop/<snapshot-id>.json
 * ```
 */

const PROJECT_SUFFIX = '.archguide.json';
const CONFIG_FILE = 'archguide.config.json';

export interface FolderConfig {
  profile?: string;
  defaultProject?: string;
  codeRoot?: string;
}

export interface FolderProject {
  id: string;
  name: string;
  file: string;
}

/** The parts of FileSystemDirectoryHandle this module uses (lets tests pass a fake). */
export interface DirectoryLike {
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
}

export interface FileLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

async function readText(dir: DirectoryLike, name: string): Promise<string | undefined> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return undefined;
  }
}

async function writeText(dir: DirectoryLike, name: string, text: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
}

async function subdir(dir: DirectoryLike, path: string[], create: boolean) {
  let current = dir;
  for (const part of path) current = await current.getDirectoryHandle(part, { create });
  return current;
}

export class FolderStore {
  /** The folder that holds the project files. */
  private dir: DirectoryLike | null = null;
  /** IDs of projects that have a file in the folder: saving them also writes the file. */
  private linked = new Set<string>();
  /** Name of the folder the user picked. */
  name = '';
  config: FolderConfig = {};
  private listeners = new Set<() => void>();
  /** Increases on every change, for React's useSyncExternalStore. */
  revision = 0;

  isLinked(id: string): boolean {
    return this.dir !== null && this.linked.has(id);
  }

  get isOpen(): boolean {
    return this.dir !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.revision++;
    for (const l of this.listeners) l();
  }

  /**
   * Opens a folder. A repository root with an `architecture/` folder opens that folder;
   * any other folder is used as it is.
   */
  async open(picked: DirectoryLike): Promise<void> {
    let dir = picked;
    try {
      dir = await picked.getDirectoryHandle('architecture');
    } catch {
      // No architecture/ folder inside: the picked folder is the architecture folder.
    }
    const configText = await readText(dir, CONFIG_FILE);
    let config: FolderConfig = {};
    if (configText) {
      try {
        config = JSON.parse(configText) as FolderConfig;
      } catch {
        throw new Error(`${CONFIG_FILE} is not valid JSON.`);
      }
    }
    this.dir = dir;
    this.name = picked.name;
    this.config = config;
    this.linked.clear();
    await this.listProjects();
    this.changed();
  }

  close(): void {
    this.dir = null;
    this.linked.clear();
    this.name = '';
    this.config = {};
    this.changed();
  }

  async listProjects(): Promise<FolderProject[]> {
    if (!this.dir) return [];
    const found: FolderProject[] = [];
    for await (const [file, entry] of this.dir.entries()) {
      if (entry.kind !== 'file' || !file.endsWith(PROJECT_SUFFIX)) continue;
      try {
        const p = parseProject((await readText(this.dir, file)) ?? '');
        found.push({ id: p.id, name: p.name, file });
        this.linked.add(p.id);
      } catch {
        // Not a valid project file: skip it, the others still open.
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  async hasProject(id: string): Promise<boolean> {
    return this.dir !== null && (await readText(this.dir, `${id}${PROJECT_SUFFIX}`)) !== undefined;
  }

  async readProject(id: string): Promise<Project> {
    if (!this.dir) throw new Error('No folder is open.');
    const text = await readText(this.dir, `${id}${PROJECT_SUFFIX}`);
    if (text === undefined) throw new Error(`${id}${PROJECT_SUFFIX} was not found.`);
    return parseProject(text);
  }

  /** Writes the project file, and a config file the first time. */
  async writeProject(p: Project): Promise<void> {
    if (!this.dir) return;
    await writeText(this.dir, `${p.id}${PROJECT_SUFFIX}`, serializeProject(p));
    this.linked.add(p.id);
    if ((await readText(this.dir, CONFIG_FILE)) === undefined) {
      this.config = { profile: p.profile, defaultProject: p.id };
      await writeText(
        this.dir,
        CONFIG_FILE,
        `${JSON.stringify({ $schema: 'https://archguide.dev/schema/config.json', ...this.config }, null, 2)}\n`,
      );
    }
    this.changed();
  }

  async writeSnapshot(projectId: string, id: string, json: string): Promise<void> {
    if (!this.dir || !(await this.hasProject(projectId))) return;
    const dir = await subdir(this.dir, ['.archguide', 'snapshots', projectId], true);
    await writeText(dir, `${id}.json`, json);
  }

  async readSnapshot(projectId: string, id: string): Promise<Project | undefined> {
    if (!this.dir) return undefined;
    try {
      const dir = await subdir(this.dir, ['.archguide', 'snapshots', projectId], false);
      const text = await readText(dir, `${id}.json`);
      return text === undefined ? undefined : parseProject(text);
    } catch {
      return undefined;
    }
  }

  async deleteSnapshot(projectId: string, id: string): Promise<void> {
    if (!this.dir) return;
    try {
      const dir = await subdir(this.dir, ['.archguide', 'snapshots', projectId], false);
      await dir.removeEntry(`${id}.json`);
    } catch {
      // Already gone.
    }
  }
}

/** The one folder the app has open, if any. */
export const folder = new FolderStore();

/** Whether this browser can open folders (File System Access API). */
export const canOpenFolders = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;
