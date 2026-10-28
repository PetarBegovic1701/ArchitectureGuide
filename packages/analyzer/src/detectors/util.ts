import { posix } from 'node:path';
import type { Evidence, Fact } from '@archguide/core';
import type { DetectorContext } from '../context';
import { at } from '../context';
import type { PackageInfo } from '../discover';

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

/** Line of a dependency in package.json, for evidence. */
export async function depEvidence(
  ctx: DetectorContext,
  p: PackageInfo,
  dep: string,
): Promise<Evidence> {
  const file = p.dir ? `${p.dir}/package.json` : 'package.json';
  const text = (await ctx.engines.read(file)) ?? '';
  const i = text.split('\n').findIndex((l) => l.includes(`"${dep}"`));
  return at(file, i >= 0 ? i + 1 : undefined, dep);
}

export const hasDep = (p: PackageInfo, ...deps: string[]) => deps.some((d) => p.deps.has(d));

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
