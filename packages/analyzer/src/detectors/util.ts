import { posix } from 'node:path';
import type { Evidence, Fact } from '@archguide/core';
import type { DetectorContext } from '../context';
import { at } from '../context';
import type { PackageInfo } from '../discover';
import { manifestOf } from '../discover';

const ACRONYMS = new Set(['api', 'bff', 'db', 'ui', 'sdk', 'cms', 'crm', 'erp', 'id', 'url', 'ws']);

/** "orders-api" → "Orders API", "orderItem" → "Order item". */
export function title(raw: string): string {
  const words = raw
    .replace(/^@[^/]+\//, '')
    .replace(/\.[a-z]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_./\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return (
    words
      .map((w, i) =>
        ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w,
      )
      .join(' ') || raw
  );
}

/** A package's short name: its folder ("services/orders" → "orders"), else its package name. */
export const shortName = (p: PackageInfo) =>
  posix.basename(p.dir) || p.name.replace(/^@[^/]+\//, '');

/**
 * The display name of a package: "Orders API" for the .NET project "Orders.Api" (its dots
 * separate words, they are not a file extension), "Orders" for "services/orders".
 */
export const packageTitle = (p: PackageInfo) =>
  title(p.language === 'dotnet' ? shortName(p).replace(/\./g, '-') : shortName(p));

/**
 * Line of a dependency in the package's manifests (package.json, pyproject.toml,
 * requirements.txt, a .csproj …), for evidence.
 */
export async function depEvidence(
  ctx: DetectorContext,
  p: PackageInfo,
  dep: string,
): Promise<Evidence> {
  const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-_.]');
  const word = new RegExp(`(^|[^\\w.-])${escaped}([^\\w.-]|$)`, 'i');
  for (const file of [manifestOf(p), ...(p.python?.manifests ?? [])]) {
    const lines = ((await ctx.engines.read(file)) ?? '').split('\n');
    const i = lines.findIndex((l) => l.includes(`"${dep}"`));
    const j = i >= 0 ? i : lines.findIndex((l) => word.test(l));
    if (j >= 0) return at(file, j + 1, dep);
  }
  return at(manifestOf(p), undefined, dep);
}

export const hasDep = (p: PackageInfo, ...deps: string[]) => deps.some((d) => p.deps.has(d));

/** The `language` property of elements of a Python or .NET package; none for npm packages. */
export const languageProp = (p: PackageInfo): { language?: string } =>
  p.language === 'python'
    ? { language: 'python' }
    : p.language === 'dotnet'
      ? { language: p.dotnet?.language ?? 'csharp' }
      : {};

const TEST_DIR = /(^|\/)(__tests__|__mocks__|test|tests|e2e|fixtures)\//;

/** Python files of the context's package, without tests and migrations. */
export const pyFiles = (ctx: DetectorContext) =>
  ctx.files.filter(
    (f) =>
      f.endsWith('.py') &&
      !TEST_DIR.test(f) &&
      !/(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(f) &&
      !/(^|\/)(migrations|alembic\/versions)\//.test(f),
  );

/** C#, F# and Visual Basic files of the context's package, without tests and generated code. */
export const dotnetFiles = (ctx: DetectorContext) =>
  ctx.files.filter(
    (f) =>
      /\.(cs|fs|vb)$/.test(f) &&
      !TEST_DIR.test(f) &&
      !/\.(g|Designer|AssemblyInfo)\.cs$/.test(f) &&
      !/(^|\/)Migrations\//.test(f),
  );

/** Code files of the context's package, without tests and generated folders. */
export const codeFiles = (ctx: DetectorContext) =>
  ctx.files.filter(
    (f) =>
      /\.(m|c)?[jt]sx?$/.test(f) &&
      !f.endsWith('.d.ts') &&
      !/(^|\/)(__tests__|__mocks__|test|tests|e2e|fixtures)\//.test(f) &&
      !/\.(test|spec|stories)\.[jt]sx?$/.test(f),
  );

export function fact(
  ctx: DetectorContext,
  detector: string,
  f: Omit<Fact, 'detector' | 'data'> & { data?: Record<string, unknown> },
): Fact {
  void ctx;
  return { data: {}, ...f, detector };
}

/** The deployable subject that owns a package: itself when it is one, else the deployables that depend on it. */
export function deployablesFor(ctx: DetectorContext, p: PackageInfo): string[] {
  const deployables = new Set(
    ctx.facts.filter((f) => f.type === 'deployable').map((f) => f.subject),
  );
  const own = ctx.pkgSubject(p);
  if (deployables.has(own)) return [own];
  return ctx.packages
    .filter((q) => q.deps.has(p.name) && deployables.has(ctx.pkgSubject(q)))
    .map((q) => ctx.pkgSubject(q));
}
