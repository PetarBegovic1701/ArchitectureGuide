import { posix } from 'node:path';
import type { Fact } from '@archguide/core';
import type { DetectorContext } from '../context';
import { servicePorts } from './react';

/** Backend deployables other code can call, in every language. */
export const BACKEND_KINDS = /^(node|py|dotnet)\./;

export const backendServices = (ctx: DetectorContext) =>
  ctx.facts.filter((f) => f.type === 'deployable' && BACKEND_KINDS.test(f.element?.kind ?? ''));

/**
 * Turns the name of an environment variable or configuration key that holds a base URL
 * into the service it points at: a compose host (`http://orders:3000`), a localhost port, or
 * a name like ORDERS_URL / Services:Orders for the "orders" service.
 */
export async function serviceResolver(
  ctx: DetectorContext,
  services: readonly Fact[],
): Promise<(name: string) => string | undefined> {
  const ports = await servicePorts(ctx, services);
  const env = await ctx.engines.env();
  const compose = await ctx.engines.compose();
  const dirOf = (s: Fact) => ctx.packages.find((q) => ctx.pkgSubject(q) === s.subject)?.dir;
  const byHost = new Map<string, string>();
  for (const { file, services: list } of compose)
    for (const c of list) {
      const dir = c.build ? posix.normalize(posix.join(posix.dirname(file), c.build)) : undefined;
      const svc = services.find((s) => (dirOf(s) || '.') === dir);
      if (svc) byHost.set(c.name.toLowerCase(), svc.subject);
    }
  const composeUrls = compose.flatMap((c) => c.services.flatMap((s) => s.urls));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (name) => {
    const value =
      env.find((e) => e.name === name && e.url) ?? composeUrls.find((u) => u.name === name);
    const url =
      value && 'url' in value ? value.url : (value as { host?: string; port?: number } | undefined);
    if (url?.host && byHost.has(url.host)) return byHost.get(url.host);
    if (url?.port && ['localhost', '127.0.0.1'].includes(url.host ?? ''))
      return ports.get(url.port)?.subject;
    // ORDERS_URL, ORDERS_SERVICE_BASE_URL, Services:Orders:BaseUrl, CatalogApi → orders, catalog-api
    const stem = norm(
      name
        .split(':')
        .filter(
          (p) => !/^(services?|clients?|endpoints?|apis?|urls?|baseurl|httpclients?)$/i.test(p),
        )
        .join('')
        .replace(
          /[_-]?(SERVICE[_-]?)?(API[_-]?)?(URL|HOST|BASE_?URL|ORIGIN|ENDPOINT|ADDRESS)$/i,
          '',
        ),
    );
    if (!stem) return undefined;
    return services.find((s) => {
      const base = norm(posix.basename(dirOf(s) ?? ''));
      return base === stem || norm(s.element?.name ?? '') === stem || base === `${stem}api`;
    })?.subject;
  };
}
