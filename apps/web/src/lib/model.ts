import { checkNesting, makeElementId, makeRelationId } from '@archguide/core';
import type { Element, Id, Layer, Op, Project, Relation, View } from '@archguide/core';
import { catalog, conceptOf, defaultLayer, defaultSize } from './catalog';

export interface Point {
  x: number;
  y: number;
}

export function takenIds(p: Project): Set<Id> {
  return new Set([...p.model.elements.map((e) => e.id), ...p.model.relations.map((r) => r.id)]);
}

export function elementById(p: Project, id: Id): Element | undefined {
  return p.model.elements.find((e) => e.id === id);
}

export function activeView(p: Project, viewId: Id): View {
  return p.views.find((v) => v.id === viewId) ?? p.views[0]!;
}

/** IDs of all elements inside `id`, at any depth. */
export function descendantIds(p: Project, id: Id): Set<Id> {
  const result = new Set<Id>();
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of p.model.elements) {
      if (e.parentId === current && !result.has(e.id)) {
        result.add(e.id);
        queue.push(e.id);
      }
    }
  }
  return result;
}

/**
 * View-node positions are relative to the parent element when the parent is shown in the
 * same view, and absolute otherwise (Implementation.md §13.3).
 */
export function absolutePosition(p: Project, view: View, elementId: Id): Point {
  const node = view.nodes.find((n) => n.elementId === elementId);
  if (!node) return { x: 0, y: 0 };
  const el = elementById(p, elementId);
  const parentShown = el?.parentId && view.nodes.some((n) => n.elementId === el.parentId);
  if (!parentShown) return { x: node.x, y: node.y };
  const parent = absolutePosition(p, view, el!.parentId!);
  return { x: parent.x + node.x, y: parent.y + node.y };
}

export const CONTAINER_PADDING = 16;
export const CONTAINER_HEADER = 32;

/** Size of an element in a view: its own size, grown to enclose its children. */
export function nodeSize(p: Project, view: View, elementId: Id): { w: number; h: number } {
  const node = view.nodes.find((n) => n.elementId === elementId);
  const el = elementById(p, elementId);
  const base = defaultSize(el?.kind ?? '');
  let w = node?.w ?? base.w;
  let h = node?.h ?? base.h;
  const children = view.nodes.filter((n) => elementById(p, n.elementId)?.parentId === elementId);
  if (children.length > 0) {
    w = Math.max(w, 220);
    h = Math.max(h, 120);
    for (const child of children) {
      const size = nodeSize(p, view, child.elementId);
      w = Math.max(w, child.x + size.w + CONTAINER_PADDING);
      h = Math.max(h, child.y + size.h + CONTAINER_PADDING);
    }
  }
  return { w, h };
}

/** Whether an element is drawn as a frame around its children. */
export function isContainer(p: Project, view: View, elementId: Id): boolean {
  const el = elementById(p, elementId);
  if (el && conceptOf(el.kind)?.category === 'group') return true;
  return view.nodes.some((n) => elementById(p, n.elementId)?.parentId === elementId);
}

/** Innermost shown element under `point` (absolute) that may hold `childKind`. */
export function findDropParent(
  p: Project,
  view: View,
  point: Point,
  childKind: string,
  exclude: ReadonlySet<Id> = new Set(),
): Element | undefined {
  let best: { el: Element; depth: number } | undefined;
  for (const node of view.nodes) {
    if (exclude.has(node.elementId)) continue;
    const el = elementById(p, node.elementId);
    if (!el) continue;
    const pos = absolutePosition(p, view, el.id);
    const size = nodeSize(p, view, el.id);
    const inside =
      point.x >= pos.x &&
      point.x <= pos.x + size.w &&
      point.y >= pos.y &&
      point.y <= pos.y + size.h;
    if (!inside || !checkNesting(catalog, childKind, el.kind).ok) continue;
    const depth = depthOf(p, el.id);
    if (!best || depth > best.depth) best = { el, depth };
  }
  return best?.el;
}

function depthOf(p: Project, id: Id): number {
  let depth = 0;
  for (let cur = elementById(p, id)?.parentId; cur; cur = elementById(p, cur)?.parentId) depth++;
  return depth;
}

/**
 * A free spot at or near `start` (absolute) that does not overlap top-level nodes. Tries
 * to the right first (architecture diagrams read left to right), then below, in steps of
 * the node's size.
 */
export function freeSpot(
  p: Project,
  view: View,
  start: Point,
  size: { w: number; h: number },
): Point {
  const boxes = view.nodes
    .filter((n) => {
      const el = elementById(p, n.elementId);
      return !el?.parentId || !view.nodes.some((m) => m.elementId === el.parentId);
    })
    .map((n) => ({ ...absolutePosition(p, view, n.elementId), ...nodeSize(p, view, n.elementId) }));
  const gap = 24;
  const overlaps = (x: number, y: number) =>
    boxes.some(
      (b) =>
        x < b.x + b.w + gap &&
        x + size.w + gap > b.x &&
        y < b.y + b.h + gap &&
        y + size.h + gap > b.y,
    );
  const dx = size.w + 2 * gap;
  const dy = size.h + 2 * gap;
  const candidates: [number, number][] = [[0, 0]];
  for (let r = 1; r <= 12; r++) candidates.push([r, 0], [0, r], [r, r], [-r, 0], [0, -r], [r, -r]);
  for (const [i, j] of candidates) {
    const x = snap(start.x + i * dx);
    const y = snap(start.y + j * dy);
    if (!overlaps(x, y)) return { x, y };
  }
  return { x: snap(start.x), y: snap(start.y) };
}

export const GRID = 8;
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

export interface NewElement {
  ops: Op[];
  id: Id;
  /** Why the element cannot go there, when it cannot. */
  error?: string;
}

/**
 * Ops that add an element of `kind` at `point` (absolute) in a view. The parent is the
 * innermost shown element that may hold it; a concept that cannot be top-level and has no
 * valid parent under the point is refused with the nesting message.
 */
export function newElementOps(
  p: Project,
  view: View,
  kind: string,
  point: Point,
  options: { parentId?: Id; name?: string; topLevel?: boolean } = {},
): NewElement {
  const concept = conceptOf(kind);
  if (!concept) return { ops: [], id: '', error: `Unknown concept "${kind}".` };
  const name = options.name ?? concept.name;
  const id = makeElementId(concept.idPrefix, name, takenIds(p));
  const parent = options.parentId
    ? elementById(p, options.parentId)
    : options.topLevel && checkNesting(catalog, kind, null).ok
      ? undefined
      : findDropParent(p, view, point, kind);
  if (!parent) {
    const top = checkNesting(catalog, kind, null);
    if (!top.ok) return { ops: [], id, error: top.message };
  } else {
    const nested = checkNesting(catalog, kind, parent.kind);
    if (!nested.ok) return { ops: [], id, error: nested.message };
  }

  const size = defaultSize(kind);
  let position: Point;
  if (parent && view.nodes.some((n) => n.elementId === parent.id)) {
    const origin = absolutePosition(p, view, parent.id);
    const siblings = view.nodes.filter((n) => elementById(p, n.elementId)?.parentId === parent.id);
    const relative = options.parentId
      ? {
          x: CONTAINER_PADDING,
          y:
            CONTAINER_HEADER +
            siblings.reduce((y, n) => Math.max(y, n.y + nodeSize(p, view, n.elementId).h), 0),
        }
      : { x: point.x - origin.x - size.w / 2, y: point.y - origin.y - size.h / 2 };
    position = {
      x: snap(Math.max(CONTAINER_PADDING, relative.x)),
      y: snap(Math.max(CONTAINER_HEADER, relative.y)),
    };
  } else {
    position = freeSpot(p, view, { x: point.x - size.w / 2, y: point.y - size.h / 2 }, size);
  }

  const layer = defaultLayer(kind);
  const element: Element = {
    id,
    kind,
    name,
    status: 'planned',
    ...(parent ? { parentId: parent.id } : {}),
    ...(layer ? { layer } : {}),
  };
  return {
    id,
    ops: [
      { op: 'addElement', element },
      { op: 'setViewNode', viewId: view.id, node: { elementId: id, ...position } },
    ],
  };
}

/** Ops that add a relation and show it in the view. */
export function newRelationOps(
  p: Project,
  view: View,
  type: string,
  sourceId: Id,
  targetId: Id,
): { ops: Op[]; id: Id } {
  const id = makeRelationId(sourceId, type, targetId, takenIds(p));
  const relation: Relation = { id, type, sourceId, targetId, status: 'planned' };
  return {
    id,
    ops: [
      { op: 'addRelation', relation },
      { op: 'setViewEdge', viewId: view.id, edge: { relationId: id } },
    ],
  };
}

/**
 * Ops that move an element to a new parent (or top level) at an absolute position,
 * converting its stored position to the new coordinate frame.
 */
export function reparentOps(
  p: Project,
  view: View,
  id: Id,
  parentId: Id | null,
  absolute: Point,
): Op[] {
  const el = elementById(p, id);
  if (!el) return [];
  const node = view.nodes.find((n) => n.elementId === id);
  const origin =
    parentId && view.nodes.some((n) => n.elementId === parentId)
      ? absolutePosition(p, view, parentId)
      : { x: 0, y: 0 };
  const position = {
    x: snap(parentId ? Math.max(CONTAINER_PADDING, absolute.x - origin.x) : absolute.x),
    y: snap(parentId ? Math.max(CONTAINER_HEADER, absolute.y - origin.y) : absolute.y),
  };
  const ops: Op[] = [];
  if ((el.parentId ?? null) !== parentId) ops.push({ op: 'moveElement', id, parentId });
  ops.push({
    op: 'setViewNode',
    viewId: view.id,
    node: { ...(node ?? { elementId: id }), ...position },
  });
  return ops;
}

/** Ops that delete the selection. Children go with their parents; relations go with their ends. */
export function deleteOps(p: Project, elementIds: Id[], relationIds: Id[]): Op[] {
  const selected = new Set(elementIds);
  const roots = elementIds.filter((id) => {
    for (let cur = elementById(p, id)?.parentId; cur; cur = elementById(p, cur)?.parentId) {
      if (selected.has(cur)) return false;
    }
    return elementById(p, id) !== undefined;
  });
  const removed = new Set(roots.flatMap((id) => [id, ...descendantIds(p, id)]));
  const relations = relationIds.filter((rid) => {
    const r = p.model.relations.find((x) => x.id === rid);
    return r && !removed.has(r.sourceId) && !removed.has(r.targetId);
  });
  return [
    ...relations.map((id): Op => ({ op: 'removeRelation', id })),
    ...roots.map((id): Op => ({ op: 'removeElement', id, cascade: true })),
  ];
}

const LAYER_TOKENS: Record<Layer, string> = {
  presentation: 'var(--ag-presentation)',
  application: 'var(--ag-application)',
  domain: 'var(--ag-domain)',
  infrastructure: 'var(--ag-infrastructure)',
  data: 'var(--ag-data)',
  external: 'var(--ag-external)',
};

/** Color of an element: its override, else its layer, else the concept's default layer. */
export function colorOf(el: Element): string {
  if (el.color) return el.color;
  const layer = el.layer ?? defaultLayer(el.kind);
  return layer ? LAYER_TOKENS[layer] : 'var(--ag-neutral)';
}

export const LAYERS = Object.keys(LAYER_TOKENS) as Layer[];
export function layerColor(layer: Layer): string {
  return LAYER_TOKENS[layer];
}
