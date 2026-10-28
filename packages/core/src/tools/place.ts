import { SHAPES, shapeOf } from '../catalog';
import type { Catalog } from '../catalog';
import type { Element, Id, ModelOp, Project, View } from '../schema';

/** Layout constants shared with the canvas (Implementation.md §13.3). */
export const CONTAINER_PADDING = 16;
export const CONTAINER_HEADER = 32;
const GRID = 8;
const GAP = 32;
const COLUMNS = 3;

const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Default size of a concept's shape. */
export function shapeSize(catalog: Catalog, kind: string): { w: number; h: number } {
  const concept = catalog.concepts.get(kind);
  const spec = SHAPES[concept ? shapeOf(concept) : 'rect'];
  return { w: spec.width, h: spec.height };
}

/** Size of an element in a view: its own size, grown to enclose its children. */
export function viewNodeSize(
  p: Project,
  view: View,
  catalog: Catalog,
  elementId: Id,
): { w: number; h: number } {
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const size = (id: Id): { w: number; h: number } => {
    const node = view.nodes.find((n) => n.elementId === id);
    const base = shapeSize(catalog, byId.get(id)?.kind ?? '');
    let w = node?.w ?? base.w;
    let h = node?.h ?? base.h;
    const children = view.nodes.filter((n) => byId.get(n.elementId)?.parentId === id);
    if (children.length > 0) {
      w = Math.max(w, 220);
      h = Math.max(h, 120);
      for (const child of children) {
        const s = size(child.elementId);
        w = Math.max(w, child.x + s.w + CONTAINER_PADDING);
        h = Math.max(h, child.y + s.h + CONTAINER_PADDING);
      }
    }
    return { w, h };
  };
  return size(elementId);
}

/**
 * Ops that show every element and relation of the model that a view does not show yet:
 * children in rows below the children their container already shows, top-level elements
 * in a row to the right of the diagram, and relations whose two ends are shown. Agents,
 * the CLI and lessons change only the model; this makes their changes visible.
 */
export function placeMissingOps(
  p: Project,
  catalog: Catalog,
  viewId?: Id,
  /** Place only these elements (the rest stays off the view). */
  only?: ReadonlySet<Id>,
): ModelOp[] {
  const view = p.views.find((v) => v.id === viewId) ?? p.views[0];
  if (!view) return [];
  const nodes = [...view.nodes];
  const shown = new Set(nodes.map((n) => n.elementId));
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const temp = (): View => ({ ...view, nodes });
  const depth = (e: Element): number => {
    let d = 0;
    for (let x = e; x.parentId && byId.has(x.parentId); x = byId.get(x.parentId)!) d++;
    return d;
  };
  const missing = p.model.elements
    .filter((e) => !shown.has(e.id) && (!only || only.has(e.id)))
    .sort((a, b) => depth(a) - depth(b));
  const ops: ModelOp[] = [];
  const topLevel = (id: Id) => {
    const parent = byId.get(id)?.parentId;
    return !parent || !shown.has(parent);
  };
  let right = Math.max(
    0,
    ...nodes
      .filter((n) => topLevel(n.elementId))
      .map((n) => n.x + viewNodeSize(p, temp(), catalog, n.elementId).w),
  );

  const cursors = new Map<Id, { x: number; y: number; row: number; count: number }>();
  const cursorFor = (parentId: Id) => {
    let c = cursors.get(parentId);
    if (!c) {
      const bottom = Math.max(
        0,
        ...nodes
          .filter((n) => byId.get(n.elementId)?.parentId === parentId)
          .map((n) => n.y + viewNodeSize(p, temp(), catalog, n.elementId).h),
      );
      c = {
        x: CONTAINER_PADDING,
        y: bottom === 0 ? CONTAINER_HEADER : bottom + GAP,
        row: 0,
        count: 0,
      };
      cursors.set(parentId, c);
    }
    return c;
  };

  for (const el of missing) {
    const size = shapeSize(catalog, el.kind);
    let x: number;
    let y: number;
    if (el.parentId && shown.has(el.parentId)) {
      const c = cursorFor(el.parentId);
      if (c.count > 0 && c.count % COLUMNS === 0) {
        c.x = CONTAINER_PADDING;
        c.y += c.row + GAP;
        c.row = 0;
      }
      x = c.x;
      y = c.y;
      c.x += size.w + GAP;
      c.row = Math.max(c.row, size.h);
      c.count += 1;
    } else {
      x = right === 0 ? 40 : right + GAP * 2;
      y = 40;
      right = x + size.w;
    }
    const node = { elementId: el.id, x: snap(x), y: snap(y) };
    nodes.push(node);
    shown.add(el.id);
    ops.push({ op: 'setViewNode', viewId: view.id, node });
  }

  const edges = new Set(view.edges.map((e) => e.relationId));
  for (const r of p.model.relations)
    if (!edges.has(r.id) && shown.has(r.sourceId) && shown.has(r.targetId))
      ops.push({ op: 'setViewEdge', viewId: view.id, edge: { relationId: r.id } });
  return ops;
}
