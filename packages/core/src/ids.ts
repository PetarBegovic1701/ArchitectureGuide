import type { Id } from './schema';

/** "Orders API (v2)" → "orders-api-v2". Never returns an empty string. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** Adds "-2", "-3" ... until the ID is free. */
export function uniqueId(base: Id, taken: ReadonlySet<Id>): Id {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Element ID from the concept prefix and the name: ("svc", "Orders") → "svc.orders". */
export function makeElementId(prefix: string, name: string, taken: ReadonlySet<Id>): Id {
  return uniqueId(`${prefix}.${slugify(name)}`, taken);
}

/** Relation ID: ("app.web", "calls", "svc.api") → "rel.app-web-calls-svc-api". */
export function makeRelationId(
  sourceId: Id,
  type: string,
  targetId: Id,
  taken: ReadonlySet<Id>,
): Id {
  const part = (id: Id) => id.replace(/\./g, '-');
  return uniqueId(`rel.${part(sourceId)}-${type}-${part(targetId)}`, taken);
}
