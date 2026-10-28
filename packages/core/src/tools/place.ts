import { SHAPES, shapeOf } from '../catalog';
import type { Catalog } from '../catalog';
import { applyOps } from '../ops';
import type { Element, Id, ModelOp, Project, View } from '../schema';

/** Layout constants shared with the canvas (Implementation.md §13.3). */
export const CONTAINER_PADDING = 16;
export const CONTAINER_HEADER = 32;
const GRID = 8;
const GAP = 48;
const COLUMNS = 3;
const MAX_ROW_WIDTH = 1600;
/** Smallest distance kept between sibling shapes when separating them. */
const SEPARATION = 24;

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
  const willShow = new Set([...shown, ...missing.map((e) => e.id)]);
  const shownParent = (id: Id) => {
    const parent = byId.get(id)?.parentId;
    return parent && willShow.has(parent) ? parent : undefined;
  };
  // Sizes come from the view as it fills up, so a container placed after its children
  // takes the room they need instead of its default shape size.
  const sizeOf = (id: Id) => viewNodeSize(p, temp(), catalog, id);
  const right = Math.max(
    0,
    ...nodes.filter((n) => !shownParent(n.elementId)).map((n) => n.x + sizeOf(n.elementId).w),
  );

  const cursors = new Map<Id, { x: number; y: number; row: number; count: number }>();
  const cursorFor = (parentId: Id) => {
    let c = cursors.get(parentId);
    if (!c) {
      const bottom = Math.max(
        0,
        ...nodes
          .filter((n) => byId.get(n.elementId)?.parentId === parentId)
          .map((n) => n.y + sizeOf(n.elementId).h),
      );
      c = {
        x: CONTAINER_PADDING,
        y: bottom === 0 ? CONTAINER_HEADER + GRID : bottom + GAP,
        row: 0,
        count: 0,
      };
      cursors.set(parentId, c);
    }
    return c;
  };
  const place = (id: Id, x: number, y: number) => {
    nodes.push({ elementId: id, x: snap(x), y: snap(y) });
    shown.add(id);
  };

  // Children, deepest first: each grid cell uses the child's final size.
  for (const el of [...missing].sort((a, b) => depth(b) - depth(a))) {
    const parent = shownParent(el.id);
    if (!parent) continue;
    const size = sizeOf(el.id);
    const c = cursorFor(parent);
    if (c.count > 0 && c.count % COLUMNS === 0) {
      c.x = CONTAINER_PADDING;
      c.y += c.row + GAP;
      c.row = 0;
    }
    place(el.id, c.x, c.y);
    c.x += size.w + GAP;
    c.row = Math.max(c.row, size.h);
    c.count += 1;
  }

  // Top-level elements in rows to the right of the diagram, wrapping when a row gets wide.
  const left = right === 0 ? 40 : right + GAP * 2;
  const top = { x: left, y: 40, row: 0 };
  for (const el of missing) {
    if (shownParent(el.id)) continue;
    const size = sizeOf(el.id);
    if (top.x > left && top.x + size.w > left + MAX_ROW_WIDTH) {
      top.x = left;
      top.y += top.row + GAP * 2;
      top.row = 0;
    }
    place(el.id, top.x, top.y);
    top.x += size.w + GAP * 2;
    top.row = Math.max(top.row, size.h);
  }

  // Parents before children, as the model lists them.
  const placed = new Map(nodes.map((n) => [n.elementId, n]));
  const ops: ModelOp[] = missing.map((el) => ({
    op: 'setViewNode',
    viewId: view.id,
    node: placed.get(el.id)!,
  }));

  const edges = new Set(view.edges.map((e) => e.relationId));
  for (const r of p.model.relations)
    if (!edges.has(r.id) && shown.has(r.sourceId) && shown.has(r.targetId))
      ops.push({ op: 'setViewEdge', viewId: view.id, edge: { relationId: r.id } });
  return ops;
}

type Box = { x: number; y: number; w: number; h: number };

/** Two boxes closer than `SEPARATION`, so their shapes or labels would touch. */
const clash = (a: Box, b: Box) =>
  a.x < b.x + b.w + SEPARATION &&
  b.x < a.x + a.w + SEPARATION &&
  a.y < b.y + b.h + SEPARATION &&
  b.y < a.y + a.h + SEPARATION;

/** Parent of each shown element in a view, when that parent is shown too. */
function shownParents(p: Project, view: View): Map<Id, Id | undefined> {
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const shown = new Set(view.nodes.map((n) => n.elementId));
  return new Map(
    view.nodes.map((n) => {
      const parent = byId.get(n.elementId)?.parentId;
      return [n.elementId, parent && shown.has(parent) ? parent : undefined];
    }),
  );
}

/** Pairs of sibling shapes ("a|b", sorted) that clash in a view. */
function clashingPairs(p: Project, view: View, catalog: Catalog): Set<string> {
  const parents = shownParents(p, view);
  const boxes = view.nodes.map((n) => ({
    id: n.elementId,
    parent: parents.get(n.elementId),
    box: { x: n.x, y: n.y, ...viewNodeSize(p, view, catalog, n.elementId) },
  }));
  const pairs = new Set<string>();
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.parent === b.parent && clash(a.box, b.box)) pairs.add([a.id, b.id].sort().join('|'));
    }
  return pairs;
}

/**
 * Ops that move shapes apart where a change made them overlap: new shapes, and containers
 * that grew around new children into their neighbours. Only overlaps the change introduced
 * are resolved; shapes that already overlapped in `before` (placed so by the user) stay.
 * Shapes move right or down, inner containers first, so a container's final size is known
 * before its own siblings are separated.
 */
export function separateOps(
  before: Project,
  after: Project,
  catalog: Catalog,
  viewId?: Id,
): ModelOp[] {
  const view = after.views.find((v) => v.id === viewId) ?? after.views[0];
  if (!view) return [];
  const old = before.views.find((v) => v.id === view.id);
  const existed = new Set(old?.nodes.map((n) => n.elementId));
  const allowed = old ? clashingPairs(before, old, catalog) : new Set<string>();
  const nodes = view.nodes.map((n) => ({ ...n }));
  const temp = (): View => ({ ...view, nodes });
  const parents = shownParents(after, view);
  const depth = (id: Id | undefined): number => (id ? 1 + depth(parents.get(id)) : 0);

  const groups = new Map<Id | undefined, typeof nodes>();
  for (const n of nodes) {
    const parent = parents.get(n.elementId);
    groups.set(parent, [...(groups.get(parent) ?? []), n]);
  }
  const moved = new Set<Id>();
  for (const [, members] of [...groups].sort((a, b) => depth(b[0]) - depth(a[0]))) {
    if (members.length < 2) continue;
    // Moving a shape does not change its size, so sizes are measured once per group.
    const sizes = new Map(
      members.map((n) => [n.elementId, viewNodeSize(after, temp(), catalog, n.elementId)]),
    );
    const box = (n: (typeof nodes)[number]): Box => ({
      x: n.x,
      y: n.y,
      ...sizes.get(n.elementId)!,
    });
    for (let pass = 0, changed = true; changed && pass < members.length * 20; pass++) {
      changed = false;
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i]!;
          const b = members[j]!;
          if (!clash(box(a), box(b))) continue;
          if (allowed.has([a.elementId, b.elementId].sort().join('|'))) continue;
          // New shapes give way to existing ones; otherwise the one further right/down moves.
          const aNew = !existed.has(a.elementId);
          const bNew = !existed.has(b.elementId);
          const bMoves = aNew !== bNew ? bNew : b.x - a.x + (b.y - a.y) >= 0;
          const [anchor, mover] = bMoves ? [box(a), b] : [box(b), a];
          const dx = anchor.x + anchor.w + SEPARATION - mover.x;
          const dy = anchor.y + anchor.h + SEPARATION - mover.y;
          if (dx <= dy) mover.x = Math.ceil((mover.x + dx) / GRID) * GRID;
          else mover.y = Math.ceil((mover.y + dy) / GRID) * GRID;
          moved.add(mover.elementId);
          changed = true;
        }
    }
  }
  return nodes
    .filter((n) => moved.has(n.elementId))
    .map((node) => ({ op: 'setViewNode', viewId: view.id, node }));
}

/**
 * View ops after a model change (`before` → `changed`): show what is missing
 * (`placeMissingOps`), then move apart the shapes the change made overlap (`separateOps`).
 */
export function layOutChangeOps(
  before: Project,
  changed: Project,
  catalog: Catalog,
  viewId?: Id,
  only?: ReadonlySet<Id>,
): ModelOp[] {
  const placed = placeMissingOps(changed, catalog, viewId, only);
  const laid = applyOps(changed, placed, catalog);
  return laid.ok ? [...placed, ...separateOps(before, laid.project, catalog, viewId)] : placed;
}
