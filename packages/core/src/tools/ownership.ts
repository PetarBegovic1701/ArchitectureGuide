import type { Catalog } from '../catalog';
import { uniqueId } from '../ids';
import type { Id, ModelOp, Project, View } from '../schema';
import { placeMissingOps } from './place';

export interface DataOwnership {
  /** The deployable that owns the element's schema (migrates it, or `ownedBy`). */
  owner?: Id;
  /** Deployables that write it (route handlers and modules lifted to their deployable). */
  writers: Id[];
  readers: Id[];
  /** Written by a deployable other than the owner, or by several without an owner. */
  shared: boolean;
}

const WRITE_TYPES = new Set(['writes', 'enqueues', 'notifies']);
const READ_TYPES = new Set(['reads', 'processes', 'consumes', 'listens']);
const DATA_KINDS = /^pg\.(schema|table|view|job-queue|channel|function)$/;

/**
 * Who owns which data (Implementation.md §19.5, shown in the database view): per Postgres
 * schema, table and view, the owning deployable and the deployables that read and write it.
 */
export function dataOwners(p: Project, catalog: Catalog): Map<Id, DataOwnership> {
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const deployable = (id: Id): Id | undefined => {
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      if (catalog.concepts.get(cur.kind)?.category === 'deployable') return cur.id;
    return undefined;
  };
  const schemaOf = (id: Id): Id | undefined => {
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      if (cur.kind === 'pg.schema') return cur.id;
    return undefined;
  };
  const owners = new Map<Id, Id>();
  for (const e of p.model.elements)
    if (
      e.kind === 'pg.schema' &&
      typeof e.properties?.ownedBy === 'string' &&
      byId.has(e.properties.ownedBy)
    )
      owners.set(e.id, e.properties.ownedBy);
  for (const r of p.model.relations)
    if (r.type === 'migrates' && !owners.has(r.targetId)) {
      const d = deployable(r.sourceId);
      if (d) owners.set(r.targetId, d);
    }

  const out = new Map<Id, DataOwnership>();
  for (const e of p.model.elements) {
    if (!DATA_KINDS.test(e.kind)) continue;
    const schema = e.kind === 'pg.schema' ? e.id : schemaOf(e.id);
    const owner = schema ? owners.get(schema) : undefined;
    out.set(e.id, { ...(owner ? { owner } : {}), writers: [], readers: [], shared: false });
  }
  for (const r of p.model.relations) {
    const entry = out.get(r.targetId);
    const d = deployable(r.sourceId);
    if (!entry || !d) continue;
    const list = WRITE_TYPES.has(r.type)
      ? entry.writers
      : READ_TYPES.has(r.type)
        ? entry.readers
        : undefined;
    if (list && !list.includes(d)) list.push(d);
  }
  // A schema is written by everyone who writes one of its tables.
  for (const [id, entry] of out) {
    const el = byId.get(id)!;
    if (el.kind !== 'pg.schema') continue;
    for (const [other, o] of out)
      if (other !== id && schemaOf(other) === id)
        for (const w of o.writers) if (!entry.writers.includes(w)) entry.writers.push(w);
  }
  for (const entry of out.values())
    entry.shared = entry.owner
      ? entry.writers.some((w) => w !== entry.owner)
      : entry.writers.length > 1;
  return out;
}

/**
 * A database view (kind "database"): the Postgres elements and the deployables that read,
 * write or migrate them, placed. With a scope (drill-down into one database): only the
 * Postgres elements inside it. One undo step.
 */
export function databaseViewOps(
  p: Project,
  catalog: Catalog,
  name = 'Database',
  scopeElementId?: Id,
): { ops: ModelOp[]; viewId: Id } {
  const viewId = uniqueId(
    scopeElementId ? `database-${scopeElementId.replace(/\./g, '-')}` : 'database',
    new Set(p.views.map((v) => v.id)),
  );
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const keep = new Set<Id>();
  const withAncestors = (id: Id) => {
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      keep.add(cur.id);
  };
  const inScope = (id: Id) => {
    if (!scopeElementId) return true;
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
      if (cur.id === scopeElementId) return true;
    return false;
  };
  for (const e of p.model.elements)
    if (e.kind.startsWith('pg.') && inScope(e.id)) withAncestors(e.id);
  const owners = dataOwners(p, catalog);
  for (const [id, o] of owners)
    if (inScope(id)) for (const d of [o.owner, ...o.writers, ...o.readers]) if (d) keep.add(d);
  // Lay out only what the view shows: a copy of the project that holds just those elements.
  const view: View = {
    id: viewId,
    name,
    kind: 'database',
    ...(scopeElementId ? { scopeElementId } : {}),
    nodes: [],
    edges: [],
    annotations: [],
  };
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
  return {
    viewId,
    ops: [{ op: 'addView', view }, ...placeMissingOps(filtered, catalog, viewId)],
  };
}
