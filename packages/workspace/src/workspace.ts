import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseProject, serializeProject } from '@archguide/core';
import type { Project } from '@archguide/core';

/**
 * A workspace is the `architecture/` folder of a repository (Implementation.md §7.5): one
 * `<id>.archguide.json` file per project, `archguide.config.json`, and `.archguide/` for
 * generated and local files. The browser's folder mode uses the same layout.
 */

export const PROJECT_SUFFIX = '.archguide.json';
export const CONFIG_FILE = 'archguide.config.json';

export interface ExportTarget {
  format: string;
  project?: string;
  out: string;
}

export interface WorkspaceConfig {
  profile?: string;
  defaultProject?: string;
  /** The code the model describes, relative to the workspace. */
  codeRoot?: string;
  exports?: ExportTarget[];
  [key: string]: unknown;
}

export interface ProjectEntry {
  id: string;
  name: string;
  revision: number;
  file: string;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'INVALID' | 'REVISION_CONFLICT' | 'EXISTS' = 'INVALID',
  ) {
    super(message);
  }
}

/** Writes a file atomically: a temporary file next to it, then a rename. */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `work` while holding `<path>.lock`, created exclusively, so read → change → write
 * cannot interleave with another writer, in this process or another one. A lock older than
 * `staleMs` is left over from a crash and is taken over.
 */
export async function withFileLock<T>(
  path: string,
  work: () => Promise<T>,
  options: { timeoutMs?: number; staleMs?: number } = {},
): Promise<T> {
  const lock = `${path}.lock`;
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  await mkdir(dirname(path), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > (options.staleMs ?? 30_000)) await rm(lock, { force: true });
      else if (Date.now() > deadline)
        throw new WorkspaceError(`${path} is locked by another writer.`, 'REVISION_CONFLICT');
      else await sleep(15 + Math.random() * 20);
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

export class Workspace {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  get configPath(): string {
    return join(this.dir, CONFIG_FILE);
  }

  /** `.archguide/` inside the workspace: snapshots, the lock file, generated files. */
  localPath(...parts: string[]): string {
    return join(this.dir, '.archguide', ...parts);
  }

  fileFor(id: string): string {
    return join(this.dir, `${id}${PROJECT_SUFFIX}`);
  }

  async exists(): Promise<boolean> {
    try {
      await readdir(this.dir);
      return true;
    } catch {
      return false;
    }
  }

  async readConfig(): Promise<WorkspaceConfig> {
    let text: string;
    try {
      text = await readFile(this.configPath, 'utf8');
    } catch {
      return {};
    }
    try {
      return JSON.parse(text) as WorkspaceConfig;
    } catch {
      throw new WorkspaceError(`${CONFIG_FILE} is not valid JSON.`);
    }
  }

  async writeConfig(config: WorkspaceConfig): Promise<void> {
    await writeFileAtomic(this.configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  async listProjects(): Promise<ProjectEntry[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const found: ProjectEntry[] = [];
    for (const file of files.filter((f) => f.endsWith(PROJECT_SUFFIX)).sort()) {
      try {
        const p = parseProject(await readFile(join(this.dir, file), 'utf8'));
        found.push({ id: p.id, name: p.name, revision: p.revision, file });
      } catch {
        // Not a valid project file: skipped here; reading it by ID reports the error.
      }
    }
    return found;
  }

  async readProject(id: string): Promise<Project> {
    let text: string;
    try {
      text = await readFile(this.fileFor(id), 'utf8');
    } catch {
      throw new WorkspaceError(`There is no project "${id}" in ${this.dir}.`, 'NOT_FOUND');
    }
    try {
      return parseProject(text);
    } catch (error) {
      throw new WorkspaceError(`${id}${PROJECT_SUFFIX}: ${(error as Error).message}`);
    }
  }

  /**
   * Writes a project file atomically. With `expectedRevision`, the file on disk must still
   * have that revision (nobody wrote it in between), or REVISION_CONFLICT is thrown.
   */
  async writeProject(project: Project, options: { expectedRevision?: number } = {}): Promise<void> {
    if (options.expectedRevision !== undefined) {
      const current = await this.readProject(project.id).catch((e: WorkspaceError) => {
        if (e.code === 'NOT_FOUND') return undefined;
        throw e;
      });
      if ((current?.revision ?? 0) !== options.expectedRevision)
        throw new WorkspaceError(
          `${project.id} changed on disk (revision ${current?.revision}, expected ${options.expectedRevision}).`,
          'REVISION_CONFLICT',
        );
    }
    await writeFileAtomic(this.fileFor(project.id), serializeProject(project));
  }

  /** The project to use when none is named: the config's default, or the only one. */
  async resolveProjectId(id?: string): Promise<string> {
    if (id) return id;
    const config = await this.readConfig();
    if (config.defaultProject) return config.defaultProject;
    const projects = await this.listProjects();
    if (projects.length === 1) return projects[0]!.id;
    throw new WorkspaceError(
      projects.length === 0
        ? `There are no projects in ${this.dir}. Create one first.`
        : `Several projects (${projects.map((p) => p.id).join(', ')}): name one.`,
      projects.length === 0 ? 'NOT_FOUND' : 'INVALID',
    );
  }
}
