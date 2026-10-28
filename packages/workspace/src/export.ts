import { resolve } from 'node:path';
import { exportProject } from '@archguide/core';
import type { Catalog, ExportFile, ExportFormat, ExportOptions, Project } from '@archguide/core';
import type { Workspace } from './workspace';
import { PROJECT_SUFFIX, writeFileAtomic } from './workspace';

/** The export files for a project, with the pointers agents-snippet needs. */
export function exportFiles(
  ws: Workspace,
  project: Project,
  catalog: Catalog,
  format: ExportFormat,
  options: ExportOptions = {},
): ExportFile[] {
  const folder = ws.dir.split(/[\\/]/).pop() ?? 'architecture';
  return exportProject(format, project, catalog, {
    projectPath: `${folder}/${project.id}${PROJECT_SUFFIX}`,
    ...options,
  }).files;
}

/**
 * Writes export files into the workspace (`export --write`, `onboarding`, MCP `export`):
 * one file goes to `out`, to its path in `archguide.config.json` exports, or under its
 * default name; several files go into the folder `out`. Paths are relative to the
 * workspace folder (§7.5); Spec Kit and Kiro files go to the code root. Returns the
 * absolute paths written.
 */
const REPO_ROOT_FORMATS: readonly ExportFormat[] = ['speckit', 'kiro'];

export async function writeExport(
  ws: Workspace,
  project: Project,
  format: ExportFormat,
  files: readonly ExportFile[],
  out?: string,
): Promise<string[]> {
  const config = await ws.readConfig();
  const configured = config.exports?.find(
    (e) => e.format === format && (!e.project || e.project === project.id),
  );
  const single = out ?? configured?.out;
  // Spec Kit and Kiro read specs/ and .kiro/ at the repository root.
  const base = REPO_ROOT_FORMATS.includes(format) && !out ? (config.codeRoot ?? '..') : '.';
  const written: string[] = [];
  for (const f of files) {
    const target =
      files.length === 1 && single ? resolve(ws.dir, single) : resolve(ws.dir, out ?? base, f.path);
    await writeFileAtomic(target, f.content);
    written.push(target);
  }
  return written;
}
