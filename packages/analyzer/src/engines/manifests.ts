import { posix } from 'node:path';

/**
 * Manifests of Python and .NET projects (Implementation.md §19.2): the dependencies, the
 * name and what kind of program a project builds. Parsed with small readers, not with the
 * tools (nothing of the repository is run).
 */

/** PEP 503 name: lower case, runs of "-", "_" and "." become "-". */
export const normalizePy = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');

/** Requirement string → normalized distribution name: "FastAPI[all]>=0.110; python_version>'3'" → "fastapi". */
export function requirementName(spec: string): string | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec);
  return m ? normalizePy(m[1]!) : undefined;
}

/** `requirements*.txt`: one requirement per line; options (-r, -e, --index-url) are skipped. */
export function parseRequirements(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    // "name @ file:../libs/shared" keeps the name.
    const name = requirementName(line);
    if (name) out.push(name);
  }
  return out;
}

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlDoc = Record<string, Record<string, TomlValue>>;

/**
 * A small TOML reader for manifests: tables, dotted keys, strings, numbers, booleans,
 * arrays (also over several lines) and inline tables. Arrays of tables are skipped. Values
 * it cannot read are left out rather than failing the analysis.
 */
export function parseToml(text: string): TomlDoc {
  const doc: TomlDoc = { '': {} };
  let table = '';
  let i = 0;
  const src = text.replace(/\r\n/g, '\n');
  const ws = () => {
    for (;;) {
      while (i < src.length && /[ \t\n]/.test(src[i]!)) i++;
      if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++;
      else return;
    }
  };
  const lineWs = () => {
    while (i < src.length && /[ \t]/.test(src[i]!)) i++;
  };
  const str = (): string => {
    const quote = src[i]!;
    const triple = src.startsWith(quote.repeat(3), i);
    i += triple ? 3 : 1;
    let out = '';
    while (i < src.length) {
      if (triple ? src.startsWith(quote.repeat(3), i) : src[i] === quote) {
        i += triple ? 3 : 1;
        return out;
      }
      if (quote === '"' && src[i] === '\\') {
        const next = src[i + 1];
        out += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
        i += 2;
        continue;
      }
      out += src[i++];
    }
    return out;
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      lineWs();
      if (src[i] === '"' || src[i] === "'") parts.push(str());
      else {
        const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
        if (!m) break;
        parts.push(m[0]);
        i += m[0].length;
      }
      lineWs();
      if (src[i] !== '.') break;
      i++;
    }
    return parts;
  };
  const value = (): TomlValue | undefined => {
    lineWs();
    const c = src[i];
    if (c === '"' || c === "'") return str();
    if (c === '[') {
      i++;
      const arr: TomlValue[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') {
          i++;
          return arr;
        }
        const v = value();
        if (v === undefined) return arr;
        arr.push(v);
        ws();
        if (src[i] === ',') i++;
      }
    }
    if (c === '{') {
      i++;
      const o: Record<string, TomlValue> = {};
      for (;;) {
        lineWs();
        if (src[i] === '}') {
          i++;
          return o;
        }
        const k = key();
        lineWs();
        if (!k.length || src[i] !== '=') return o;
        i++;
        const v = value();
        if (v !== undefined) o[k.join('.')] = v;
        lineWs();
        if (src[i] === ',') i++;
      }
    }
    const m = /^[^\s,\]}#]+/.exec(src.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    if (m[0] === 'true' || m[0] === 'false') return m[0] === 'true';
    const n = Number(m[0].replace(/_/g, ''));
    return Number.isNaN(n) ? m[0] : n;
  };
  while (i < src.length) {
    ws();
    if (i >= src.length) break;
    if (src[i] === '[') {
      const array = src[i + 1] === '[';
      i += array ? 2 : 1;
      const name = key().join('.');
      while (i < src.length && src[i] !== '\n') i++;
      // Arrays of tables ([[tool.x]]) are not needed for manifests.
      table = array ? `[[${name}]]` : name;
      doc[table] ??= {};
      continue;
    }
    const k = key();
    lineWs();
    if (!k.length || src[i] !== '=') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    i++;
    const v = value();
    if (v !== undefined) {
      // "a.b = 1" inside [t] lands in table "t.a" as key "b".
      const t = [table, ...k.slice(0, -1)].filter(Boolean).join('.');
      (doc[t] ??= {})[k[k.length - 1]!] = v;
    }
    while (i < src.length && src[i] !== '\n') i++;
  }
  return doc;
}

export interface PythonManifest {
  name?: string;
  deps: string[];
  /** Console scripts (`[project.scripts]`, `[tool.poetry.scripts]`). */
  scripts: Record<string, string>;
  pythonVersion?: string;
}

const strings = (v: TomlValue | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** pyproject.toml: PEP 621 `[project]`, Poetry, PDM and uv dependency groups. */
export function parsePyproject(text: string): PythonManifest {
  const doc = parseToml(text);
  const project = doc['project'] ?? {};
  const poetry = doc['tool.poetry'] ?? {};
  const deps = [
    ...strings(project.dependencies),
    ...Object.values(doc['project.optional-dependencies'] ?? {}).flatMap(strings),
    ...Object.values(doc['dependency-groups'] ?? {}).flatMap(strings),
    ...strings(doc['tool.uv']?.['dev-dependencies']),
  ].flatMap((d) => requirementName(d) ?? []);
  for (const [t, entries] of Object.entries(doc))
    if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(t))
      for (const k of Object.keys(entries)) if (k !== 'python') deps.push(normalizePy(k));
  const scripts: Record<string, string> = {};
  for (const t of ['project.scripts', 'tool.poetry.scripts'])
    for (const [k, v] of Object.entries(doc[t] ?? {})) if (typeof v === 'string') scripts[k] = v;
  const name = typeof project.name === 'string' ? project.name : poetry.name;
  const python =
    typeof project['requires-python'] === 'string'
      ? project['requires-python']
      : doc['tool.poetry.dependencies']?.python;
  return {
    ...(typeof name === 'string' ? { name } : {}),
    deps: [...new Set(deps)],
    scripts,
    ...(typeof python === 'string' ? { pythonVersion: python } : {}),
  };
}

/** setup.py: `name=` and the strings of `install_requires=[...]`. */
export function parseSetupPy(text: string): PythonManifest {
  const name = /\bname\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  const block = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? '';
  const deps = [...block.matchAll(/['"]([^'"]+)['"]/g)].flatMap(
    (m) => requirementName(m[1]!) ?? [],
  );
  return { ...(name ? { name } : {}), deps, scripts: {} };
}

/** setup.cfg: `[metadata] name` and `[options] install_requires`. */
export function parseSetupCfg(text: string): PythonManifest {
  let section = '';
  let inRequires = false;
  let name: string | undefined;
  const deps: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const sec = /^\[([^\]]+)\]/.exec(raw);
    if (sec) {
      section = sec[1]!.trim();
      inRequires = false;
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(raw);
    if (kv) {
      inRequires = section === 'options' && kv[1] === 'install_requires';
      if (section === 'metadata' && kv[1] === 'name') name = kv[2]!.trim();
      if (inRequires && kv[2]!.trim()) deps.push(...(requirementName(kv[2]!) ?? []));
      continue;
    }
    if (inRequires && /^\s+\S/.test(raw)) {
      const d = requirementName(raw);
      if (d) deps.push(d);
    }
  }
  return { ...(name ? { name } : {}), deps, scripts: {} };
}

/** Pipfile: the keys of `[packages]` and `[dev-packages]`. */
export function parsePipfile(text: string): PythonManifest {
  const doc = parseToml(text);
  const deps = [...Object.keys(doc.packages ?? {}), ...Object.keys(doc['dev-packages'] ?? {})].map(
    normalizePy,
  );
  return { deps, scripts: {} };
}

export interface DotnetProject {
  /** The project file name without extension ("Orders.Api"): what ProjectReference names. */
  name: string;
  /** `Microsoft.NET.Sdk`, `Microsoft.NET.Sdk.Web`, `Microsoft.NET.Sdk.Worker` … */
  sdk: string;
  language: 'csharp' | 'fsharp' | 'vb';
  outputType?: string;
  targetFramework?: string;
  /** PackageReference Include values. */
  packages: string[];
  /** ProjectReference paths, resolved to repository-relative project files. */
  projectRefs: string[];
  /** Azure Functions projects (`AzureFunctionsVersion`). */
  functions: boolean;
}

/** A .csproj / .fsproj / .vbproj (SDK-style MSBuild XML). */
export function parseDotnetProject(file: string, text: string): DotnetProject {
  const ext = posix.extname(file);
  const tag = (name: string) =>
    new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, 'i').exec(text)?.[1];
  const attrs = (element: string) =>
    [...text.matchAll(new RegExp(`<${element}\\b[^>]*\\bInclude\\s*=\\s*"([^"]+)"`, 'gi'))].map(
      (m) => m[1]!,
    );
  const dir = posix.dirname(file);
  return {
    name: posix.basename(file, ext),
    sdk: /<Project\b[^>]*\bSdk\s*=\s*"([^"]+)"/i.exec(text)?.[1] ?? 'Microsoft.NET.Sdk',
    language: ext === '.fsproj' ? 'fsharp' : ext === '.vbproj' ? 'vb' : 'csharp',
    ...(tag('OutputType') ? { outputType: tag('OutputType')! } : {}),
    ...((tag('TargetFramework') ?? tag('TargetFrameworks'))
      ? { targetFramework: (tag('TargetFramework') ?? tag('TargetFrameworks'))!.split(';')[0]! }
      : {}),
    packages: attrs('PackageReference'),
    projectRefs: attrs('ProjectReference').map((p) =>
      posix.normalize(posix.join(dir === '.' ? '' : dir, p.replace(/\\/g, '/'))),
    ),
    functions: Boolean(tag('AzureFunctionsVersion')),
  };
}
