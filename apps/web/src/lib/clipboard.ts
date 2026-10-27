import { makeElementId, makeRelationId, slugify } from '@archguide/core';
import type { Element, Id, Op, Project, Relation, View, ViewNode } from '@archguide/core';
import { conceptOf } from './catalog';
import { absolutePosition, descendantIds, elementById, snap, takenIds } from './model';

/** What Copy keeps: elements (with their children), the relations between them, and positions. */
export interface ClipboardData {
  elements: Element[];
  relations: Relation[];
  /** Absolute positions for top-level copied elements; relative for children. */
  nodes: ViewNode[];
}

export function copySelection(p: Project, view: View, ids: Id[]): ClipboardData | undefined {
  const all = new Set<Id>();
  for (const id of ids) {
    if (!elementById(p, id)) continue;
    all.add(id);
    for (const d of descendantIds(p, id)) all.add(d);
  }
  if (all.size === 0) return undefined;
  const elements = p.model.elements.filter((e) => all.has(e.id));
  const relations = p.model.relations.filter((r) => all.has(r.sourceId) && all.has(r.targetId));
  const nodes = view.nodes
    .filter((n) => all.has(n.elementId))
    .map((n) => {
      const el = elementById(p, n.elementId)!;
      const isRoot = !el.parentId || !all.has(el.parentId);
      return isRoot ? { ...n, ...absolutePosition(p, view, n.elementId) } : n;
    });
  return structuredClone({ elements, relations, nodes });
}

/**
 * Ops that paste clipboard data with fresh IDs, offset by `offset`. Pasted roots are placed
 * at top level, so they never land in a parent that does not accept them.
 */
export function pasteOps(
  p: Project,
  view: View,
  data: ClipboardData,
  offset = 32,
): { ops: Op[]; ids: Id[] } {
  const taken = takenIds(p);
  const idMap = new Map<Id, Id>();
  for (const el of data.elements) {
    const prefix = conceptOf(el.kind)?.idPrefix ?? el.id.split('.')[0]!;
    const id = makeElementId(prefix, slugify(el.name), taken);
    taken.add(id);
    idMap.set(el.id, id);
  }
  const ops: Op[] = [];
  const roots: Id[] = [];
  // Parents before children.
  const ordered = [...data.elements].sort((a, b) => depth(data, a) - depth(data, b));
  for (const el of ordered) {
    const id = idMap.get(el.id)!;
    const parentId = el.parentId ? idMap.get(el.parentId) : undefined;
    const copy: Element = { ...structuredClone(el), id };
    if (parentId) copy.parentId = parentId;
    else {
      delete copy.parentId;
      roots.push(id);
    }
    delete copy.source;
    ops.push({ op: 'addElement', element: copy });
  }
  for (const r of data.relations) {
    const sourceId = idMap.get(r.sourceId)!;
    const targetId = idMap.get(r.targetId)!;
    const id = makeRelationId(sourceId, r.type, targetId, taken);
    taken.add(id);
    const copy: Relation = { ...structuredClone(r), id, sourceId, targetId };
    delete copy.source;
    ops.push(
      { op: 'addRelation', relation: copy },
      { op: 'setViewEdge', viewId: view.id, edge: { relationId: id } },
    );
  }
  for (const n of data.nodes) {
    const id = idMap.get(n.elementId)!;
    const isRoot = roots.includes(id);
    ops.push({
      op: 'setViewNode',
      viewId: view.id,
      node: {
        ...n,
        elementId: id,
        ...(isRoot ? { x: snap(n.x + offset), y: snap(n.y + offset) } : {}),
      },
    });
  }
  return { ops, ids: [...idMap.values()] };
}

function depth(data: ClipboardData, el: Element): number {
  let d = 0;
  for (let cur = el.parentId; cur; cur = data.elements.find((e) => e.id === cur)?.parentId) d++;
  return d;
}
