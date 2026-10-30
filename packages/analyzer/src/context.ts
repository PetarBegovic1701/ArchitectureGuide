import { posix } from 'node:path';
import type { Evidence, Fact } from '@archguide/core';
import type { Discovered, PackageInfo } from './discover';
import { packageOf, readInside } from './discover';
import { hashText } from './cache';
import type { IndexCache } from './cache';
import { buildGraph } from './engines/graph';
import type { ImportGraph, PathAliases } from './engines/graph';
import { indexSource, isCode } from './engines/ts-index';
import type { FileIndex } from './engines/ts-index';
import { parsePrisma } from './engines/prisma';
import type { PrismaSchema } from './engines/prisma';
import { parseSql } from './engines/sql';
import type { SqlFile } from './engines/sql';
import { parseCompose, parseEnv } from './engines/config';
import type { ComposeService, EnvVar } from './engines/config';
import { indexPython } from './engines/py-index';
import type { PyIndex } from './engines/py-index';
import { indexCSharp } from './engines/cs-index';
import type { CsIndex } from './engines/cs-index';

/** Engines shared by all detectors of one run; everything is parsed lazily, once. */
export class Engines {
  private texts = new Map<string, Promise<string | undefined>>();
  private indexes = new Map<string, FileIndex>();
  private prismas = new Map<string, Promise<PrismaSchema | undefined>>();
  private sqls = new Map<string, Promise<SqlFile | undefined>>();
  private pys = new Map<string, Promise<PyIndex | undefined>>();
  private css = new Map<string, Promise<CsIndex | undefined>>();
  private graphPromise?: Promise<ImportGraph>;
  readonly warnings: string[] = [];
  parsedFiles = 0;

  constructor(
    readonly repo: Discovered,
    private readonly cache: IndexCache,
  ) {}

  read(file: string): Promise<string | undefined> {
    let p = this.texts.get(file);
    if (!p) {
      p = readInside(this.repo.root, file).catch((error: Error) => {
        this.warnings.push(error.message);
        return undefined;
      });
      this.texts.set(file, p);
    }
    return p;
  }

  async index(file: string): Promise<FileIndex | undefined> {
    if (!isCode(file)) return undefined;
    const known = this.indexes.get(file);
    if (known) return known;
    const text = await this.read(file);
    if (text === undefined) return undefined;
    const hash = hashText(text);
    let index = this.cache.get(file, hash);
    if (!index) {
      try {
        index = indexSource(file, text);
      } catch (error) {
        this.warnings.push(`${file}: could not be parsed (${(error as Error).message})`);
        return undefined;
      }
      this.cache.set(file, hash, index);
      this.parsedFiles++;
    }
    this.indexes.set(file, index);
    return index;
  }

  prisma(file: string): Promise<PrismaSchema | undefined> {
    let p = this.prismas.get(file);
    if (!p) {
      p = this.read(file).then((t) => (t === undefined ? undefined : parsePrisma(t)));
      this.prismas.set(file, p);
    }
    return p;
  }

  sql(file: string): Promise<SqlFile | undefined> {
    let p = this.sqls.get(file);
    if (!p) {
      p = this.read(file).then(async (t) => {
        if (t === undefined) return undefined;
        const r = await parseSql(t);
        if (r.error) this.warnings.push(`${file}: SQL not parsed (${r.error})`);
        return r;
      });
      this.sqls.set(file, p);
    }
    return p;
  }

  /** A Python module's index (Implementation.md §19.3). */
  py(file: string): Promise<PyIndex | undefined> {
    let p = this.pys.get(file);
    if (!p) {
      p = this.read(file).then((t) => {
        if (t === undefined) return undefined;
        try {
          return indexPython(t);
        } catch (error) {
          this.warnings.push(`${file}: could not be parsed (${(error as Error).message})`);
          return undefined;
        }
      });
      this.pys.set(file, p);
    }
    return p;
  }

  /** A C# file's index. */
  cs(file: string): Promise<CsIndex | undefined> {
    let p = this.css.get(file);
    if (!p) {
      p = this.read(file).then((t) => {
        if (t === undefined || !file.endsWith('.cs')) return undefined;
        try {
          return indexCSharp(t);
        } catch (error) {
          this.warnings.push(`${file}: could not be parsed (${(error as Error).message})`);
          return undefined;
        }
      });
      this.css.set(file, p);
    }
    return p;
  }

  async compose(): Promise<{ file: string; services: ComposeService[] }[]> {
    const files = this.repo.files.filter((f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(f));
    const out = [];
    for (const file of files) {
      const text = await this.read(file);
      if (text === undefined) continue;
      const r = parseCompose(text);
      if (r.error) this.warnings.push(`${file}: ${r.error}`);
      out.push({ file, services: r.services });
    }
    return out;
  }

  async env(): Promise<EnvVar[]> {
    const files = this.repo.files.filter((f) => /(^|\/)\.env(\.[\w.-]+)?$/.test(f));
    const out: EnvVar[] = [];
    for (const file of files) {
      const text = await this.read(file);
      if (text !== undefined) out.push(...parseEnv(file, text));
    }
    return out;
  }

  graph(): Promise<ImportGraph> {
    this.graphPromise ??= (async () => {
      const code = this.repo.files.filter(isCode);
      const indexes = new Map<string, FileIndex>();
      for (const f of code) {
        const i = await this.index(f);
        if (i) indexes.set(f, i);
      }
      return buildGraph(code, indexes, this.repo.packages, await this.aliases());
    })();
    return this.graphPromise;
  }

  /** `compilerOptions.paths` of every tsconfig.json (JSON with comments). */
  private async aliases(): Promise<PathAliases[]> {
    const out: PathAliases[] = [];
    for (const f of this.repo.files.filter((x) => /(^|\/)tsconfig[\w.]*\.json$/.test(x))) {
      const text = await this.read(f);
      if (!text) continue;
      try {
        const json = JSON.parse(
          text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1'),
        ) as {
          compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
        };
        const paths = json.compilerOptions?.paths;
        if (paths) {
          const dir = posix.dirname(f);
          out.push({
            dir: dir === '.' ? '' : dir,
            baseUrl: json.compilerOptions?.baseUrl ?? '.',
            paths,
          });
        }
      } catch {
        // not plain JSON (extends chains with comments we cannot read): skip
      }
    }
    return out;
  }
}

/** What a detector gets (Implementation.md §19.3). */
export interface DetectorContext {
  root: string;
  /** The package being analyzed; for repository detectors, the root package or the first one. */
  pkg: PackageInfo;
  packages: PackageInfo[];
  /** Files of this package (repository detectors: all files). */
  files: string[];
  engines: Engines;
  /** Facts reported so far (repository detectors run after the package ones). */
  facts: readonly Fact[];
  /** Subject of a package: "pkg:services/orders". */
  pkgSubject(p: PackageInfo): string;
  packageOf(file: string): PackageInfo | undefined;
  warn(message: string): void;
}

export interface Detector {
  id: string;
  /** "package" (default): once per package; "repo": once, after all package detectors. */
  scope?: 'package' | 'repo';
  appliesTo?(pkg: PackageInfo): boolean;
  run(ctx: DetectorContext): Promise<Fact[]>;
}

export const pkgSubject = (p: PackageInfo) => `pkg:${p.dir || '.'}`;

export function makeContext(
  engines: Engines,
  pkg: PackageInfo,
  files: string[],
  facts: readonly Fact[],
): DetectorContext {
  return {
    root: engines.repo.root,
    pkg,
    packages: engines.repo.packages,
    files,
    engines,
    facts,
    pkgSubject,
    packageOf: (f) => packageOf(engines.repo.packages, f),
    warn: (m) => engines.warnings.push(m),
  };
}

/** Shorthand for evidence. */
export const at = (path: string, line?: number, symbol?: string): Evidence => ({
  path,
  ...(line ? { line } : {}),
  ...(symbol ? { symbol } : {}),
});

/** The files of a package below one of its folders. */
export const under = (ctx: DetectorContext, ...dirs: string[]) => {
  const base = ctx.pkg.dir ? `${ctx.pkg.dir}/` : '';
  return ctx.files.filter((f) => dirs.some((d) => f.startsWith(`${base}${d}`)));
};
