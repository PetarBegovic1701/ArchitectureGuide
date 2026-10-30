import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import { parse as parseYaml } from 'yaml';
import {
  normalizePy,
  parseDotnetProject,
  parsePipfile,
  parsePyproject,
  parseRequirements,
  parseSetupCfg,
  parseSetupPy,
} from './engines/manifests';
import type { DotnetProject, PythonManifest } from './engines/manifests';

/** What a package is written in: npm packages, Python projects, .NET projects. */
export type PackageLanguage = 'js' | 'python' | 'dotnet';

export interface PackageInfo {
  /**
   * `name` from package.json or pyproject.toml, the .NET project name ("Orders.Api"), or
   * the folder name.
   */
  name: string;
  /** Folder relative to the repository root, POSIX separators; "" for the root. */
  dir: string;
  /** Default "js". */
  language?: PackageLanguage;
  /** The manifest the package was found by, for evidence (default `<dir>/package.json`). */
  manifestFile?: string;
  /** Python projects: what the manifests say. */
  python?: Pick<PythonManifest, 'scripts' | 'pythonVersion'> & { manifests: string[] };
  /** .NET projects: the parsed project file. */
  dotnet?: DotnetProject;
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

/** Folders of virtual environments and build output of Python and .NET projects. */
const LANGUAGE_IGNORED = [
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/site-packages/**',
  '**/.tox/**',
  '**/.mypy_cache/**',
  '**/obj/**',
  '**/bin/Debug/**',
  '**/bin/Release/**',
];

const PY_MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'requirements.txt'];

/**
 * Python projects: folders with a pyproject.toml, setup.py, setup.cfg, Pipfile or
 * requirements*.txt. The repository root counts only when no folder below it is a project
 * (a root pyproject.toml of a monorepo is usually tooling).
 */
async function pythonPackages(root: string): Promise<PackageInfo[]> {
  const files = await fg(
    [...PY_MANIFESTS.map((m) => `**/${m}`), '**/requirements*.txt', '**/requirements/*.txt'],
    { cwd: root, ignore: [...ALWAYS_IGNORED, ...LANGUAGE_IGNORED], followSymbolicLinks: false },
  );
  const byDir = new Map<string, string[]>();
  for (const f of files.sort()) {
    let dir = posix.dirname(f);
    if (posix.basename(dir) === 'requirements' && f.endsWith('.txt')) dir = posix.dirname(dir);
    const d = dir === '.' ? '' : dir;
    byDir.set(d, [...(byDir.get(d) ?? []), f]);
  }
  if (byDir.size > 1) byDir.delete('');
  const out: PackageInfo[] = [];
  for (const [dir, manifests] of byDir) {
    const parsed: PythonManifest[] = [];
    for (const f of manifests) {
      const text = await readFile(join(root, f), 'utf8').catch(() => '');
      const base = posix.basename(f);
      parsed.push(
        base === 'pyproject.toml'
          ? parsePyproject(text)
          : base === 'setup.py'
            ? parseSetupPy(text)
            : base === 'setup.cfg'
              ? parseSetupCfg(text)
              : base === 'Pipfile'
                ? parsePipfile(text)
                : { deps: parseRequirements(text), scripts: {} },
      );
    }
    const deps = new Set(parsed.flatMap((m) => m.deps));
    const name = parsed.find((m) => m.name)?.name ?? (posix.basename(dir) || 'root');
    const pythonVersion = parsed.find((m) => m.pythonVersion)?.pythonVersion;
    // The main manifest: pyproject.toml first, then the others in PY_MANIFESTS order.
    const main =
      PY_MANIFESTS.map((m) => manifests.find((f) => posix.basename(f) === m)).find(Boolean) ??
      manifests[0]!;
    out.push({
      name: normalizePy(name),
      dir,
      language: 'python',
      manifestFile: main,
      manifest: { dependencies: {}, devDependencies: {}, scripts: {} },
      deps,
      python: {
        manifests,
        scripts: Object.assign({}, ...parsed.map((m) => m.scripts)) as Record<string, string>,
        ...(pythonVersion ? { pythonVersion } : {}),
      },
    });
  }
  return out;
}

/**
 * .NET projects: every .csproj, .fsproj and .vbproj. The dependencies are the NuGet
 * packages and the names of the referenced projects, so a project reference reads like a
 * workspace dependency.
 */
async function dotnetPackages(root: string): Promise<PackageInfo[]> {
  const files = await fg(['**/*.csproj', '**/*.fsproj', '**/*.vbproj'], {
    cwd: root,
    ignore: [...ALWAYS_IGNORED, ...LANGUAGE_IGNORED],
    followSymbolicLinks: false,
  });
  const projects = await Promise.all(
    files.sort().map(async (f) => ({
      file: f,
      project: parseDotnetProject(f, await readFile(join(root, f), 'utf8').catch(() => '')),
    })),
  );
  const nameOf = new Map(projects.map((p) => [p.file, p.project.name]));
  return projects.flatMap(({ file, project }) => {
    const d = posix.dirname(file);
    const refs = project.projectRefs.map(
      (r) => nameOf.get(r) ?? posix.basename(r).replace(/\.\w+proj$/, ''),
    );
    return [
      {
        name: project.name,
        dir: d === '.' ? '' : d,
        language: 'dotnet' as const,
        manifestFile: file,
        manifest: { dependencies: {}, devDependencies: {}, scripts: {} },
        deps: new Set([...project.packages, ...refs]),
        dotnet: project,
      },
    ];
  });
}

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
  packages.push(...(await pythonPackages(root)), ...(await dotnetPackages(root)));
  packages.sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));

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
    ignore: [...ALWAYS_IGNORED, ...LANGUAGE_IGNORED, ...(options.exclude ?? [])],
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

/** The manifest a package was found by: package.json, pyproject.toml, a .csproj … */
export const manifestOf = (p: PackageInfo) =>
  p.manifestFile ?? (p.dir ? `${p.dir}/package.json` : 'package.json');

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
