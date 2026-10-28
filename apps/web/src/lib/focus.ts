import { GraphQuery, neighborhood } from '@archguide/core';
import type { Id, Project } from '@archguide/core';
import { catalog } from './catalog';
import type { CanvasFilters } from '../store/ui';

export const hasFilters = (f: CanvasFilters) =>
  f.tags.length + f.layers.length + f.statuses.length + f.owners.length > 0;

/** Values the filter menus offer: what the project uses. */
export function filterChoices(p: Project): CanvasFilters {
  const g = new GraphQuery(p, catalog);
  const sorted = (values: Iterable<string | undefined>) =>
    [...new Set([...values].filter((v): v is string => Boolean(v)))].sort();
  return {
    tags: sorted(p.model.elements.flatMap((e) => e.tags ?? [])),
    layers: sorted(p.model.elements.map((e) => g.layerOf(e.id))),
    statuses: sorted(p.model.elements.map((e) => e.status)),
    owners: sorted(p.model.elements.map((e) => e.owner)),
  };
}

/**
 * What focus mode and the filters dim (Implementation.md §13.5): with a selection and a
 * focus depth, everything not within that many relations of it; with filters, shapes that
 * do not match (their containers stay, so the match keeps its context). Arrows are dimmed
 * when one of their ends is.
 */
export function dimmedIds(
  p: Project,
  options: { focus?: { ids: readonly Id[]; depth: number } | null; filters?: CanvasFilters },
): Set<Id> | null {
  const focusOn = options.focus && options.focus.ids.length > 0;
  const filterOn = options.filters && hasFilters(options.filters);
  if (!focusOn && !filterOn) return null;
  const g = new GraphQuery(p, catalog);
  const keep = new Set<Id>(p.model.elements.map((e) => e.id));
  if (focusOn) {
    const near = new Set<Id>();
    for (const id of options.focus!.ids)
      for (const x of neighborhood(p, catalog, id, options.focus!.depth)) near.add(x);
    for (const id of [...keep]) if (!near.has(id)) keep.delete(id);
  }
  if (filterOn) {
    const f = options.filters!;
    const matches = (id: Id) => {
      const e = g.element(id)!;
      return (
        (!f.tags.length || (e.tags ?? []).some((t) => f.tags.includes(t))) &&
        (!f.layers.length || f.layers.includes(g.layerOf(id) ?? '')) &&
        (!f.statuses.length || f.statuses.includes(e.status)) &&
        (!f.owners.length || f.owners.includes(e.owner ?? ''))
      );
    };
    const hits = new Set([...keep].filter(matches));
    for (const id of [...hits]) for (const a of g.ancestors(id)) hits.add(a.id);
    for (const id of [...keep]) if (!hits.has(id)) keep.delete(id);
  }
  const dimmed = new Set<Id>(p.model.elements.filter((e) => !keep.has(e.id)).map((e) => e.id));
  for (const r of p.model.relations)
    if (dimmed.has(r.sourceId) || dimmed.has(r.targetId)) dimmed.add(r.id);
  return dimmed;
}
