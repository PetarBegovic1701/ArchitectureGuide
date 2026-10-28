import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { newProject } from '@archguide/core';
import type { Catalog } from '@archguide/core';
import {
  CONFIG_FILE,
  createInWorkspace,
  exportFiles,
  writeExport,
  writeFileAtomic,
} from '@archguide/workspace';
import type { Workspace, WorkspaceConfig } from '@archguide/workspace';
import { CliError, findAsset } from './io';

export interface InitOptions {
  cwd: string;
  template?: string;
  name?: string;
  id?: string;
  skill: boolean;
}

export interface InitResult {
  workspace: string;
  projectId: string;
  created: string[];
  log: string[];
}

/** Local files of the workspace that do not belong in git (§7.5). */
const gitignoreLines = (folder: string) => [
  `${folder}/.archguide/analysis/`,
  `${folder}/.archguide/server.json`,
  `${folder}/*.lock`,
  `${folder}/*.tmp`,
];

/**
 * `archguide init` (Implementation.md §22): the workspace config, a project (empty or from
 * a template), ARCHITECTURE.md, the Claude Code skill, and .gitignore entries. Parts that
 * already exist are left alone, so running it twice is safe.
 */
export async function init(ws: Workspace, catalog: Catalog, o: InitOptions): Promise<InitResult> {
  const log: string[] = [];
  const created: string[] = [];
  const config = await ws.readConfig();
  const root = resolve(ws.dir, config.codeRoot ?? '..');
  const show = (path: string) => relative(o.cwd, path) || '.';

  let projectId = (await ws.listProjects())[0]?.id;
  if (projectId && (o.template || o.name || o.id))
    log.push(
      `kept the existing project "${projectId}" (--template, --name and --id apply to new projects)`,
    );
  if (!projectId) {
    const name = o.name ?? (basename(root) || 'Architecture');
    const r = newProject(catalog, {
      name,
      ...(o.id ? { id: o.id } : {}),
      ...(o.template ? { templateId: o.template } : {}),
    });
    if ('errors' in r)
      throw new CliError(
        r.errors.map((e) => `${e.message}${e.hint ? ` ${e.hint}` : ''}`).join('\n'),
      );
    await createInWorkspace(ws, r.project);
    projectId = r.project.id;
    created.push(ws.fileFor(projectId));
    log.push(`created ${show(ws.fileFor(projectId))}${o.template ? ` from ${o.template}` : ''}`);
  }

  if (!(await exists(ws.configPath))) {
    const next: WorkspaceConfig = {
      profile: catalog.profiles[0]?.id ?? 'core',
      defaultProject: projectId,
      codeRoot: '..',
      exports: [{ format: 'agent-md', project: projectId, out: 'ARCHITECTURE.md' }],
      ...config,
    };
    await ws.writeConfig(next);
    created.push(ws.configPath);
    log.push(`created ${show(join(ws.dir, CONFIG_FILE))}`);
  }

  const project = await ws.readProject(projectId);
  const [md] = await writeExport(
    ws,
    project,
    'agent-md',
    exportFiles(ws, project, catalog, 'agent-md'),
  );
  log.push(`wrote ${show(md!)}`);

  if (o.skill) {
    const target = join(root, '.claude', 'skills', 'archguide', 'SKILL.md');
    if (await exists(target)) log.push(`kept ${show(target)}`);
    else {
      const source = findAsset(join('skills', 'archguide', 'SKILL.md'));
      if (!source) throw new CliError('The skill file is missing from this installation.', 3);
      await writeFileAtomic(target, await readFile(source, 'utf8'));
      created.push(target);
      log.push(`copied the Claude Code skill to ${show(target)}`);
    }
  }

  const gitignore = join(root, '.gitignore');
  const current = (await exists(gitignore)) ? await readFile(gitignore, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = gitignoreLines(relative(root, ws.dir).split('\\').join('/') || '.').filter(
    (l) => !have.has(l),
  );
  if (missing.length) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    await writeFile(
      gitignore,
      `${current}${prefix}${current ? '\n' : ''}# ArchitectureGuide\n${missing.join('\n')}\n`,
    );
    log.push(`added ${missing.length} line(s) to ${show(gitignore)}`);
  }

  return { workspace: ws.dir, projectId, created, log };
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
