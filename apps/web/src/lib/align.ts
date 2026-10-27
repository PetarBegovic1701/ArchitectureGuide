import type { Id, Op, Project, View } from '@archguide/core';
import { elementById, nodeSize, snap } from './model';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Distribution = 'horizontal' | 'vertical';

interface Box {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Boxes of the selected shapes that share one coordinate frame: the same shown parent,
 * or the top level. Returns undefined when the selection mixes frames.
 */
function boxes(p: Project, view: View, ids: readonly Id[]): Box[] | undefined {
  const shown = new Set(view.nodes.map((n) => n.elementId));
  const frame = (id: Id) => {
    const parent = elementById(p, id)?.parentId;
    return parent && shown.has(parent) ? parent : '';
  };
  const selected = view.nodes.filter((n) => ids.includes(n.elementId));
  if (selected.length < 2 || new Set(selected.map((n) => frame(n.elementId))).size > 1)
    return undefined;
  return selected.map((n) => ({
    id: n.elementId,
    x: n.x,
    y: n.y,
    ...nodeSize(p, view, n.elementId),
  }));
}

/** Why the selection cannot be aligned, or undefined when it can. */
export function alignProblem(
  p: Project,
  view: View,
  ids: readonly Id[],
  min = 2,
): string | undefined {
  const selected = view.nodes.filter((n) => ids.includes(n.elementId));
  if (selected.length < min) return `Select at least ${min} shapes.`;
  if (!boxes(p, view, ids)) return 'Select shapes in the same container (or all at the top level).';
  return undefined;
}

function moves(p: Project, view: View, moved: Box[]): Op[] {
  return moved.map((b) => {
    const node = view.nodes.find((n) => n.elementId === b.id)!;
    return { op: 'setViewNode', viewId: view.id, node: { ...node, x: snap(b.x), y: snap(b.y) } };
  });
}

export function alignOps(p: Project, view: View, ids: readonly Id[], how: Alignment): Op[] {
  const list = boxes(p, view, ids);
  if (!list) return [];
  const left = Math.min(...list.map((b) => b.x));
  const right = Math.max(...list.map((b) => b.x + b.w));
  const top = Math.min(...list.map((b) => b.y));
  const bottom = Math.max(...list.map((b) => b.y + b.h));
  const moved = list.map((b) => {
    switch (how) {
      case 'left':
        return { ...b, x: left };
      case 'right':
        return { ...b, x: right - b.w };
      case 'center':
        return { ...b, x: (left + right) / 2 - b.w / 2 };
      case 'top':
        return { ...b, y: top };
      case 'bottom':
        return { ...b, y: bottom - b.h };
      case 'middle':
        return { ...b, y: (top + bottom) / 2 - b.h / 2 };
    }
  });
  return moves(p, view, moved);
}

/** Equal gaps between the shapes, keeping the first and the last where they are. */
export function distributeOps(p: Project, view: View, ids: readonly Id[], how: Distribution): Op[] {
  const list = boxes(p, view, ids);
  if (!list || list.length < 3) return [];
  const horizontal = how === 'horizontal';
  const pos = (b: Box) => (horizontal ? b.x : b.y);
  const size = (b: Box) => (horizontal ? b.w : b.h);
  const sorted = [...list].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const used = sorted.reduce((sum, b) => sum + size(b), 0);
  const gap = (pos(last) + size(last) - pos(first) - used) / (sorted.length - 1);
  let cursor = pos(first);
  const moved = sorted.map((b) => {
    const at = cursor;
    cursor += size(b) + gap;
    return horizontal ? { ...b, x: at } : { ...b, y: at };
  });
  return moves(p, view, moved);
}
