import type { Catalog } from '../catalog';
import { GraphQuery } from '../graph';
import { slugify, uniqueId } from '../ids';
import type { Element, Id, ModelOp, Project, View } from '../schema';
import { databaseViewOps } from './ownership';
import { placeMissingOps } from './place';

export type GeneratedViewKind = 'context' | 'container' | 'component' | 'database' | 'scenario';

/** Outermost: no ancestor other than groups. */
function outermost(g: GraphQuery, e: Element): boolean {
  return g.ancestors(e.id).every((a) => g.category(a) === 'group');
}

/** The outermost data element at or above `e` (a database, not its schema or table). */
function outerData(g: GraphQuery, e: Element): Element {
  const chain = [e, ...g.ancestors(e.id)].filter((x) => {
    const c = g.category(x);
    return c === 'data-at-rest' || c === 'data-in-motion';
  });
  return chain.at(-1) ?? e;
}

/**
 * The elements a generated view shows (Implementation.md §13.8): context — deployables,
 * actors and external systems; container — those and the data stores; component — one
 * deployable's inside and what it talks to (lifted to their deployable or store).
 */
export function viewElementIds(
  p: Project,
  catalog: Catalog,
  kind: Exclude<GeneratedViewKind, 'database' | 'scenario'>,
  scopeElementId?: Id,
): Set<Id> {
  const g = new GraphQuery(p, catalog);
  const out = new Set<Id>();
  const cat = (e: Element) => g.category(e);
  if (kind === 'context' || kind === 'container') {
    for (const e of p.model.elements) {
      const c = cat(e);
      const people = c === 'actor' || c === 'external';
      const runs = c === 'deployable' && outermost(g, e);
      const data =
        kind === 'container' &&
        (c === 'data-at-rest' || c === 'data-in-motion') &&
        outerData(g, e).id === e.id;
      if ((people && outermost(g, e)) || runs || data) out.add(e.id);
    }
    return out;
  }
  const scope = scopeElementId ? g.element(scopeElementId) : undefined;
  if (!scope) return out;
  const inside = new Set(g.subtree(scope.id).map((e) => e.id));
  for (const id of inside) out.add(id);
  const lift = (id: Id) => {
    const e = g.element(id)!;
    return g.deployableOf(id) ?? (cat(e) === 'actor' ? e : outerData(g, e));
  };
  for (const id of inside)
    for (const r of [...g.outgoing(id), ...g.incoming(id)]) {
      const other = r.sourceId === id ? r.targetId : r.sourceId;
      if (!inside.has(other)) out.add(lift(other).id);
    }
  return out;
}

const VIEW_NAMES: Record<GeneratedViewKind, string> = {
  context: 'Context',
  container: 'Containers',
  component: 'Components',
  database: 'Database',
  scenario: 'Scenario',
};

/**
 * A new view of a kind, with its shapes placed (one undo step). Component and database
 * views can be scoped to an element (drill-down); a scenario starts as a copy of the
 * shapes and arrows of `fromViewId` with no steps.
 */
export function generateViewOps(
  p: Project,
  catalog: Catalog,
  input: { kind: GeneratedViewKind; scopeElementId?: Id; name?: string; fromViewId?: Id },
): { ops: ModelOp[]; viewId: Id } {
  const scope = input.scopeElementId
    ? p.model.elements.find((e) => e.id === input.scopeElementId)
    : undefined;
  const name =
    input.name ?? (scope ? `${VIEW_NAMES[input.kind]}: ${scope.name}` : VIEW_NAMES[input.kind]);
  if (input.kind === 'database') return databaseViewOps(p, catalog, name, scope?.id);
  const viewId = uniqueId(
    `${input.kind}${scope ? `-${slugify(scope.name)}` : ''}`,
    new Set(p.views.map((v) => v.id)),
  );
  if (input.kind === 'scenario') {
    const from = p.views.find((v) => v.id === input.fromViewId) ?? p.views[0];
    const view: View = {
      id: viewId,
      name,
      kind: 'scenario',
      nodes: from ? from.nodes.map((n) => ({ ...n })) : [],
      edges: from ? from.edges.map((e) => ({ ...e })) : [],
      annotations: [],
      scenario: { steps: [] },
    };
    return { viewId, ops: [{ op: 'addView', view }] };
  }
  const keep = viewElementIds(p, catalog, input.kind, scope?.id);
  const view: View = {
    id: viewId,
    name,
    kind: input.kind,
    ...(scope ? { scopeElementId: scope.id } : {}),
    nodes: [],
    edges: [],
    annotations: [],
  };
  // Lay out only what the view shows: a copy of the project that holds just those elements.
  const filtered: Project = {
    ...p,
    model: {
      elements: p.model.elements
        .filter((e) => keep.has(e.id))
        .map((e) => (e.parentId && !keep.has(e.parentId) ? { ...e, parentId: undefined } : e)),
      relations: p.model.relations.filter((r) => keep.has(r.sourceId) && keep.has(r.targetId)),
    },
    views: [view],
  };
  return { viewId, ops: [{ op: 'addView', view }, ...placeMissingOps(filtered, catalog, viewId)] };
}

/**
 * Drill-down (§13.3): double-clicking a deployable opens its component view, a database its
 * database view. Returns the view to open, or what to create; undefined when the element
 * has nothing to drill into.
 */
export function drillDown(
  p: Project,
  catalog: Catalog,
  elementId: Id,
): { viewId: Id } | { create: { kind: GeneratedViewKind; scopeElementId: Id } } | undefined {
  const el = p.model.elements.find((e) => e.id === elementId);
  if (!el) return undefined;
  const category = catalog.concepts.get(el.kind)?.category;
  const kind: GeneratedViewKind | undefined =
    category === 'deployable' ? 'component' : el.kind === 'pg.database' ? 'database' : undefined;
  if (!kind) return undefined;
  const existing = p.views.find((v) => v.kind === kind && v.scopeElementId === elementId);
  return existing ? { viewId: existing.id } : { create: { kind, scopeElementId: elementId } };
}

/**
 * Breadcrumbs of a view: the first view, then the views scoped to the ancestors of this
 * view's scope (outermost first), then the view itself.
 */
export function viewBreadcrumbs(p: Project, viewId: Id): View[] {
  const view = p.views.find((v) => v.id === viewId);
  const root = p.views[0];
  if (!view || !root) return [];
  if (!view.scopeElementId || view.id === root.id)
    return view.id === root.id ? [root] : [root, view];
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const chain: View[] = [];
  for (let cur = byId.get(view.scopeElementId)?.parentId; cur; cur = byId.get(cur)?.parentId) {
    const scoped = p.views.find((v) => v.scopeElementId === cur && v.id !== view.id);
    if (scoped) chain.unshift(scoped);
  }
  return [root, ...chain.filter((v) => v.id !== root.id), view];
}
