import { posix } from 'node:path';
import type { PackageInfo } from '../discover';
import { packageOf } from '../discover';
import type { FileIndex } from './ts-index';
import { CODE_EXTENSIONS } from './ts-index';

export interface ImportEdge {
  from: string;
  /** A repository file, or undefined for an npm package. */
  to?: string;
  /** npm package name ("@prisma/client") for bare imports that are not workspace packages. */
  external?: string;
  specifier: string;
  line: number;
  typeOnly: boolean;
}

export interface ImportGraph {
  edges: ImportEdge[];
  /** Outgoing edges per file. */
  out: Map<string, ImportEdge[]>;
  /** Import cycles between repository files (type-only imports left out), each sorted. */
  cycles: string[][];
}

/** Package name of a bare specifier: "@scope/pkg/sub" → "@scope/pkg", "pg/lib" → "pg". */
export const packageName = (spec: string) =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!;

export interface PathAliases {
  /** Folder the aliases belong to (the tsconfig's folder). */
  dir: string;
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * Resolves the imports of the indexed files (Implementation.md §19.2): relative paths,
 * tsconfig `paths`, and workspace package names. Anything else is an npm package.
 */
export function buildGraph(
  files: readonly string[],
  indexes: ReadonlyMap<string, FileIndex>,
  packages: readonly PackageInfo[],
  aliases: readonly PathAliases[],
): ImportGraph {
  const known = new Set(files);
  const tryFile = (base: string): string | undefined => {
    const clean = posix.normalize(base);
    if (known.has(clean) && CODE_EXTENSIONS.some((e) => clean.endsWith(e))) return clean;
    // "./x.js" written for TypeScript sources.
    const stripped = clean.replace(/\.(m|c)?js$/, '');
    for (const e of CODE_EXTENSIONS) if (known.has(stripped + e)) return stripped + e;
    for (const e of CODE_EXTENSIONS)
      if (known.has(`${clean}/index${e}`)) return `${clean}/index${e}`;
    return undefined;
  };
  const byName = new Map(packages.map((p) => [p.name, p]));
  const packageEntry = (p: PackageInfo, sub: string) => {
    const base = p.dir ? `${p.dir}/` : '';
    if (sub) return tryFile(`${base}${sub}`) ?? tryFile(`${base}src/${sub}`);
    const main = p.manifest.main?.replace(/^\.\//, '');
    return (
      (main && tryFile(`${base}${main}`)) ?? tryFile(`${base}src/index`) ?? tryFile(`${base}index`)
    );
  };
  const aliasFor = (file: string) =>
    aliases
      .filter((a) => a.dir === '' || file.startsWith(`${a.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length)[0];

  const edges: ImportEdge[] = [];
  for (const from of files) {
    const index = indexes.get(from);
    if (!index) continue;
    for (const imp of index.imports) {
      const spec = imp.specifier;
      let to: string | undefined;
      let external: string | undefined;
      if (spec.startsWith('.')) to = tryFile(posix.join(posix.dirname(from), spec));
      else if (spec.startsWith('node:')) continue;
      else {
        const alias = aliasFor(from);
        for (const [pattern, targets] of Object.entries(alias?.paths ?? {})) {
          const star = pattern.indexOf('*');
          const prefix = star >= 0 ? pattern.slice(0, star) : pattern;
          if (star >= 0 ? !spec.startsWith(prefix) : spec !== pattern) continue;
          const rest = star >= 0 ? spec.slice(prefix.length) : '';
          for (const t of targets) {
            to = tryFile(posix.join(alias!.dir, alias!.baseUrl, t.replace('*', rest)));
            if (to) break;
          }
          if (to) break;
        }
        if (!to) {
          const name = packageName(spec);
          const ws = byName.get(name);
          if (ws) to = packageEntry(ws, spec.slice(name.length + 1));
          else external = name;
        }
      }
      if (!to && !external) continue;
      edges.push({
        from,
        ...(to ? { to } : {}),
        ...(external ? { external } : {}),
        specifier: spec,
        line: imp.line,
        typeOnly: imp.typeOnly,
      });
    }
  }
  const out = new Map<string, ImportEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  return { edges, out, cycles: cyclesOf(edges) };
}

/** Strongly connected components with more than one file (Tarjan). */
function cyclesOf(edges: readonly ImportEdge[]): string[][] {
  const next = new Map<string, string[]>();
  for (const e of edges)
    if (e.to && !e.typeOnly && e.to !== e.from)
      next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  let counter = 0;
  const strong = (v: string) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) result.push(scc.sort());
    }
  };
  for (const v of [...next.keys()].sort()) if (!index.has(v)) strong(v);
  return result.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** The workspace package a graph node belongs to. */
export const packageOfFile = packageOf;
