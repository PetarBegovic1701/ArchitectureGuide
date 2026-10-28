import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { parse as parseYaml } from 'yaml';

export interface PackageInfo {
  /** `name` from package.json, or the folder name. */
  name: string;
  /** Folder relative to the repository root, POSIX separators; "" for the root. */
  dir: string;
  manifest: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
    main?: string;
    bin?: unknown;
    private?: boolean;
  };
  /** dependencies + devDependencies + peerDependencies */
  deps: Set<string>;
}

export interface DiscoverOptions {
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  /** Bytes; larger files are skipped. */
  maxFileSize?: number;
}

export interface Discovered {
  root: string;
  packages: PackageInfo[];
  /** Files to analyze, relative to the root, POSIX separators, sorted. */
  files: string[];
  monorepo: 'turborepo' | 'nx' | null;
  warnings: string[];
}

export const DEFAULT_MAX_FILES = 20_000;
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Never analyzed, whatever .gitignore says. */
const ALWAYS_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.archguide/**',
];

const toPosix = (p: string) => p.split(sep).join('/');

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function packageInfo(dir: string, json: Record<string, unknown>): PackageInfo {
  const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, string>) : {});
  const manifest: PackageInfo['manifest'] = {
    dependencies: rec(json.dependencies),
    devDependencies: rec(json.devDependencies),
    scripts: rec(json.scripts),
    ...(typeof json.main === 'string' ? { main: json.main } : {}),
    ...(json.bin ? { bin: json.bin } : {}),
    ...(json.private === true ? { private: true } : {}),
  };
  return {
    name: typeof json.name === 'string' ? json.name : posix.basename(dir) || 'root',
    dir,
    manifest,
    deps: new Set([
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
      ...Object.keys(rec(json.peerDependencies)),
    ]),
  };
}

/** Workspace globs from package.json `workspaces` and pnpm-workspace.yaml. */
async function workspaceGlobs(root: string, rootJson: Record<string, unknown> | undefined) {
  const globs: string[] = [];
  const ws = rootJson?.workspaces;
  if (Array.isArray(ws)) globs.push(...ws.map(String));
  else if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages))
    globs.push(...(ws as { packages: unknown[] }).packages.map(String));
  try {
    const yaml = parseYaml(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
      packages?: unknown[];
    };
    if (Array.isArray(yaml?.packages)) globs.push(...yaml.packages.map(String));
  } catch {
    // no pnpm workspace
  }
  return globs;
}

/**
 * Finds the packages and the files to analyze (Implementation.md §19.2): workspace packages
 * from the manifests, files without .gitignored ones, include / exclude, and the limits.
 * Symbolic links are not followed, so nothing outside the repository is read.
 */
export async function discover(
  repoRoot: string,
  options: DiscoverOptions = {},
): Promise<Discovered> {
  const root = await realpath(resolve(repoRoot));
  const warnings: string[] = [];
  const rootJson = await readJson(join(root, 'package.json'));
  const globs = await workspaceGlobs(root, rootJson);

  const packages: PackageInfo[] = [];
  if (globs.length) {
    const positive = globs.filter((g) => !g.startsWith('!'));
    const negative = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
    const dirs = await fg(
      positive.map((g) => posix.join(g.replace(/\/+$/, ''), 'package.json')),
      {
        cwd: root,
        ignore: [...ALWAYS_IGNORED, ...negative.map((g) => posix.join(g, 'package.json'))],
        followSymbolicLinks: false,
      },
    );
    for (const file of dirs.sort()) {
      const json = await readJson(join(root, file));
      if (json) packages.push(packageInfo(posix.dirname(file), json));
    }
  }
  if (packages.length === 0 && rootJson) packages.push(packageInfo('', rootJson));

  const gitignore = ignore();
  for (const file of await fg(['**/.gitignore'], {
    cwd: root,
    ignore: ALWAYS_IGNORED,
    dot: true,
  })) {
    const base = posix.dirname(file);
    const lines = (await readFile(join(root, file), 'utf8')).split(/\r?\n/);
    for (const line of lines) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const negated = l.startsWith('!');
      const pattern = negated ? l.slice(1) : l;
      // Patterns of nested .gitignore files apply below their folder.
      const scoped =
        base === '.'
          ? pattern
          : posix.join(base, pattern.startsWith('/') ? pattern.slice(1) : `**/${pattern}`);
      gitignore.add(negated ? `!${scoped}` : scoped);
    }
  }

  const listed = await fg(options.include?.length ? options.include : ['**/*'], {
    cwd: root,
    ignore: [...ALWAYS_IGNORED, ...(options.exclude ?? [])],
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    stats: true,
  });
  const maxSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  let tooBig = 0;
  let files = listed
    .filter((entry) => {
      if (gitignore.ignores(entry.path)) return false;
      if (entry.dirent.isSymbolicLink()) return false;
      if ((entry.stats?.size ?? 0) > maxSize) {
        tooBig++;
        return false;
      }
      return true;
    })
    .map((entry) => entry.path)
    .sort();
  if (tooBig)
    warnings.push(`${tooBig} file(s) over ${Math.round(maxSize / 1024)} KB were skipped.`);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (files.length > maxFiles) {
    warnings.push(
      `The repository has ${files.length} files; only the first ${maxFiles} were analyzed (maxFiles). The result is partial.`,
    );
    files = files.slice(0, maxFiles);
  }

  const monorepo = existsSync(join(root, 'turbo.json'))
    ? 'turborepo'
    : existsSync(join(root, 'nx.json'))
      ? 'nx'
      : null;
  return { root, packages, files, monorepo, warnings };
}

/** The package a file belongs to: the deepest package folder that contains it. */
export function packageOf(packages: readonly PackageInfo[], file: string): PackageInfo | undefined {
  let best: PackageInfo | undefined;
  for (const p of packages)
    if (p.dir === '' || file === p.dir || file.startsWith(`${p.dir}/`))
      if (!best || p.dir.length > best.dir.length) best = p;
  return best;
}

/**
 * Reads a file of the repository. Refuses paths that leave the root, also through
 * symbolic links (§25: no file outside the repo is read).
 */
export async function readInside(root: string, file: string): Promise<string> {
  const full = resolve(root, file);
  const outside = (p: string) => {
    const rel = relative(root, p);
    return rel === '' || rel.startsWith('..') || resolve(root, rel) !== p;
  };
  if (outside(full)) throw new Error(`Refused to read ${file}: it is outside the repository.`);
  const real = await realpath(full);
  if (outside(real)) throw new Error(`Refused to read ${file}: it is outside the repository.`);
  if ((await stat(real)).size > DEFAULT_MAX_FILE_SIZE * 4) throw new Error(`${file} is too large.`);
  return readFile(real, 'utf8');
}

export { toPosix };
