import type { Element, Id, Op, Project, View } from '@archguide/core';
import { defaultSize } from './catalog';
import { CONTAINER_HEADER, CONTAINER_PADDING, nodeSize, snap } from './model';

const GAP = 32;
const COLUMNS = 3;

/**
 * Ops that show every element and relation of the model that the view does not show yet:
 * children in a grid inside their parent, top-level elements in a row to the right of the
 * diagram, and relations whose two ends are shown. Lesson start models and "Show me"
 * solutions only change the model, so the lesson player places them with this (§17.5).
 */
export function placeOps(p: Project, view: View): Op[] {
  const nodes = [...view.nodes];
  const shown = new Set(nodes.map((n) => n.elementId));
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const depth = (e: Element): number => {
    let d = 0;
    for (let x = e; x.parentId && byId.has(x.parentId); x = byId.get(x.parentId)!) d++;
    return d;
  };
  const missing = p.model.elements
    .filter((e) => !shown.has(e.id))
    .sort((a, b) => depth(a) - depth(b));
  const ops: Op[] = [];
  const temp = (): View => ({ ...view, nodes });
  let right = Math.max(
    0,
    ...nodes
      .filter(
        (n) => !byId.get(n.elementId)?.parentId || !shown.has(byId.get(n.elementId)!.parentId!),
      )
      .map((n) => n.x + nodeSize(p, temp(), n.elementId).w),
  );

  // New children go in rows below the children a container already shows.
  const cursors = new Map<Id, { x: number; y: number; row: number; count: number }>();
  const cursorFor = (parentId: Id) => {
    let c = cursors.get(parentId);
    if (!c) {
      const bottom = Math.max(
        0,
        ...nodes
          .filter((n) => byId.get(n.elementId)?.parentId === parentId)
          .map((n) => n.y + nodeSize(p, temp(), n.elementId).h),
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
    const size = defaultSize(el.kind);
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

/** IDs of elements that `ops` add. */
export const addedElementIds = (ops: readonly Op[]): Id[] =>
  ops.flatMap((op) => (op.op === 'addElement' ? [op.element.id] : []));
