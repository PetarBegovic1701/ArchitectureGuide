import { uniqueId } from '@archguide/core';
import type { Annotation, Id, Op, Project, View } from '@archguide/core';
import { absolutePosition, elementById, nodeSize, snap } from './model';
import type { Point } from './model';

/**
 * Annotations on the canvas (Implementation.md §15): sticky notes, regions, callouts and
 * comments. They are React Flow nodes too; their node IDs start with "ann:", which no
 * element ID can (IDs have no colon).
 */
export const ANN = 'ann:';
export const annNodeId = (id: Id) => `${ANN}${id}`;
export const annIdOf = (nodeId: string): Id | undefined =>
  nodeId.startsWith(ANN) ? nodeId.slice(ANN.length) : undefined;

export const STICKY_SIZE = { w: 180, h: 120 };
export const REGION_SIZE = { w: 480, h: 320 };

export const ANNOTATION_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff'];

export type Box = { x: number; y: number; w: number; h: number };

/** Box of an element or the middle of a relation, as shown in the view. */
export function anchorBox(p: Project, view: View, anchor: Annotation['anchor']): Box | undefined {
  if ('elementId' in anchor) {
    if (!view.nodes.some((n) => n.elementId === anchor.elementId)) return undefined;
    return {
      ...absolutePosition(p, view, anchor.elementId),
      ...nodeSize(p, view, anchor.elementId),
    };
  }
  if ('relationId' in anchor) {
    const r = p.model.relations.find((x) => x.id === anchor.relationId);
    if (!r || !view.edges.some((e) => e.relationId === r.id)) return undefined;
    const a = anchorBox(p, view, { elementId: r.sourceId });
    const b = anchorBox(p, view, { elementId: r.targetId });
    if (!a || !b) return undefined;
    const x = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
    const y = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
    return { x, y, w: 0, h: 0 };
  }
  return { x: anchor.x, y: anchor.y, w: anchor.w ?? 0, h: anchor.h ?? 0 };
}

function newId(view: View, kind: Annotation['kind']): Id {
  return uniqueId(`${kind}-${Date.now().toString(36)}`, new Set(view.annotations.map((a) => a.id)));
}

function upsert(view: View, annotation: Annotation): Op[] {
  return [{ op: 'upsertAnnotation', viewId: view.id, annotation }];
}

/** A sticky note with its top-left corner at `at`. */
export function stickyOps(view: View, at: Point, now: string): { id: Id; ops: Op[] } {
  const id = newId(view, 'sticky');
  return {
    id,
    ops: upsert(view, {
      id,
      kind: 'sticky',
      text: '',
      color: ANNOTATION_COLORS[0],
      anchor: { x: snap(at.x), y: snap(at.y), ...STICKY_SIZE },
      createdAt: now,
    }),
  };
}

/** A region around the given boxes (with a margin), or a default-size region at `at`. */
export function regionOps(
  view: View,
  at: Point,
  around: Box[],
  now: string,
): { id: Id; ops: Op[] } {
  const id = newId(view, 'region');
  const margin = 32;
  const box =
    around.length > 0
      ? {
          x: Math.min(...around.map((b) => b.x)) - margin,
          y: Math.min(...around.map((b) => b.y)) - margin - 24,
          w:
            Math.max(...around.map((b) => b.x + b.w)) -
            Math.min(...around.map((b) => b.x)) +
            2 * margin,
          h:
            Math.max(...around.map((b) => b.y + b.h)) -
            Math.min(...around.map((b) => b.y)) +
            2 * margin +
            24,
        }
      : { x: at.x - REGION_SIZE.w / 2, y: at.y - REGION_SIZE.h / 2, ...REGION_SIZE };
  return {
    id,
    ops: upsert(view, {
      id,
      kind: 'region',
      text: 'Region',
      color: ANNOTATION_COLORS[2],
      anchor: { x: snap(box.x), y: snap(box.y), w: snap(box.w), h: snap(box.h) },
      createdAt: now,
    }),
  };
}

export function anchoredOps(
  view: View,
  kind: 'callout' | 'comment',
  anchor: Annotation['anchor'],
  text: string,
  now: string,
): { id: Id; ops: Op[] } {
  const id = newId(view, kind);
  return { id, ops: upsert(view, { id, kind, text, anchor, createdAt: now }) };
}

export const CALLOUT_WIDTH = 224;

/** Where a callout box goes: centered above what it points at. */
export function calloutPosition(target: Box): Point {
  return { x: target.x + target.w / 2 - CALLOUT_WIDTH / 2, y: target.y - 88 };
}

/** Label for an annotation's anchor in lists and exports. */
export function anchorLabel(p: Project, anchor: Annotation['anchor']): string | undefined {
  if ('elementId' in anchor) return elementById(p, anchor.elementId)?.name ?? anchor.elementId;
  if ('relationId' in anchor) {
    const r = p.model.relations.find((x) => x.id === anchor.relationId);
    if (!r) return anchor.relationId;
    return `${elementById(p, r.sourceId)?.name ?? r.sourceId} → ${elementById(p, r.targetId)?.name ?? r.targetId}`;
  }
  return undefined;
}
