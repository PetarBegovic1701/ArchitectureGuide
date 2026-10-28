import type { Edge, Node } from '@xyflow/react';
import type {
  Annotation,
  Id,
  LineStyle,
  Project,
  Relation,
  ShapeId,
  Status,
  View,
} from '@archguide/core';
import { catalog, conceptOf, shapeFor } from './catalog';
import { absolutePosition, colorOf, elementById, isContainer, nodeSize } from './model';
import type { Issue } from './findings';
import {
  REGION_SIZE,
  STICKY_SIZE,
  anchorBox,
  anchorLabel,
  annNodeId,
  calloutPosition,
} from './annotations';

export type ShapeNodeData = {
  elementId: Id;
  name: string;
  kind: string;
  conceptName: string;
  icon: string;
  shape: ShapeId;
  color: string;
  w: number;
  h: number;
  container: boolean;
  status: Status;
  editing: boolean;
  /** Open findings about this element (worst severity first). */
  issue?: Issue;
  /** Part of the finding the user is looking at. */
  highlighted: boolean;
  /** New or changed since the snapshot the canvas is compared with. */
  diff?: DiffMark;
  /** Accepted or proposed decisions linked to the element. */
  decisionIds?: Id[];
  /** Change-set mode: a shape the change removes, drawn from the baseline. Not editable. */
  ghost?: boolean;
};

export type DiffMark = 'added' | 'changed' | 'removed';

export type RelationEdgeData = {
  relation: Relation;
  typeName: string;
  line: LineStyle;
  /** Position among relations between the same two elements, so parallel arrows do not overlap. */
  parallelIndex: number;
  parallelCount: number;
  issue?: Issue;
  highlighted: boolean;
  diff?: DiffMark;
  /** Focus mode or a filter: not part of what the user looks at. */
  dimmed?: boolean;
};

export type ShapeFlowNode = Node<ShapeNodeData, 'shape'>;
export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

export interface FlowOptions {
  selectedIds?: ReadonlySet<Id>;
  editingId?: Id | null;
  /** While connecting: the source and the elements that may be targets. */
  connecting?: { sourceId: Id; validTargets: ReadonlySet<Id> } | null;
  issues?: ReadonlyMap<Id, Issue>;
  highlightIds?: ReadonlySet<Id>;
  compare?: {
    added: ReadonlySet<Id>;
    changed: ReadonlySet<Id>;
    removed?: ReadonlySet<Id>;
  } | null;
  /** Focus mode and filters: these are dimmed. */
  dimmed?: ReadonlySet<Id> | null;
  decisions?: ReadonlyMap<Id, Id[]>;
  /** Ownership colors (database view): they replace the shapes' own colors. */
  ownership?: ReadonlyMap<Id, string> | null;
}

/**
 * React Flow paints all nodes in one layer above the edges. Containers are see-through
 * (only their header and border catch the pointer), so arrows inside them stay visible
 * and clickable; leaf shapes sit above containers.
 */
const Z_CONTAINER = 0;
const Z_LEAF = 1000;

/** React Flow nodes for a view: parents before children, child positions relative to parents. */
export function toFlowNodes(p: Project, view: View, options: FlowOptions = {}): ShapeFlowNode[] {
  const shown = new Set(view.nodes.map((n) => n.elementId));
  const depth = (id: Id): number => {
    const parent = elementById(p, id)?.parentId;
    return parent && shown.has(parent) ? 1 + depth(parent) : 0;
  };
  return view.nodes
    .map((node) => ({ node, el: elementById(p, node.elementId), d: depth(node.elementId) }))
    .filter((x): x is typeof x & { el: NonNullable<typeof x.el> } => x.el !== undefined)
    .sort((a, b) => a.d - b.d)
    .map(({ node, el, d }) => {
      const concept = conceptOf(el.kind);
      const size = nodeSize(p, view, el.id);
      const container = isContainer(p, view, el.id);
      const parentShown = el.parentId !== undefined && shown.has(el.parentId);
      let className: string | undefined;
      if (options.connecting) {
        if (options.connecting.validTargets.has(el.id)) className = 'ag-target-valid';
        else if (options.connecting.sourceId !== el.id) className = 'ag-target-invalid';
      }
      return {
        id: el.id,
        type: 'shape' as const,
        position: { x: node.x, y: node.y },
        ...(parentShown ? { parentId: el.parentId } : {}),
        width: size.w,
        height: size.h,
        zIndex: container ? Z_CONTAINER + d : Z_LEAF + d,
        selected: options.selectedIds?.has(el.id) ?? false,
        ...(className || container || options.dimmed?.has(el.id)
          ? {
              className: [
                className,
                container ? 'ag-container' : '',
                options.dimmed?.has(el.id) ? 'ag-dimmed' : '',
              ]
                .filter(Boolean)
                .join(' '),
            }
          : {}),
        data: {
          elementId: el.id,
          name: el.name,
          kind: el.kind,
          conceptName: concept?.name ?? el.kind,
          icon: concept?.icon ?? 'box',
          shape: container ? 'container' : shapeFor(el.kind),
          color: options.ownership?.get(el.id) ?? colorOf(el),
          w: size.w,
          h: size.h,
          container,
          status: el.status,
          editing: options.editingId === el.id,
          ...withIssue(options.issues?.get(el.id)),
          highlighted: options.highlightIds?.has(el.id) ?? false,
          ...diffMark(options, el.id),
          ...(options.decisions?.get(el.id) ? { decisionIds: options.decisions.get(el.id)! } : {}),
        },
      };
    });
}

/** React Flow edges for the relations shown in a view whose two ends are shown. */
export function toFlowEdges(p: Project, view: View, options: FlowOptions = {}): RelationFlowEdge[] {
  const shown = new Set(view.nodes.map((n) => n.elementId));
  const listed = new Set(view.edges.map((e) => e.relationId));
  const relations = p.model.relations.filter(
    (r) => listed.has(r.id) && shown.has(r.sourceId) && shown.has(r.targetId),
  );
  const pairKey = (r: Relation) => [r.sourceId, r.targetId].sort().join('|');
  const groups = new Map<string, Relation[]>();
  for (const r of relations) groups.set(pairKey(r), [...(groups.get(pairKey(r)) ?? []), r]);
  return relations.map((r) => {
    const type = catalog.relationTypes.get(r.type);
    const group = groups.get(pairKey(r))!;
    return {
      id: r.id,
      type: 'relation' as const,
      source: r.sourceId,
      target: r.targetId,
      selected: options.selectedIds?.has(r.id) ?? false,
      data: {
        relation: r,
        typeName: type?.name ?? r.type,
        line: type?.line ?? { width: 1.5, marker: 'arrow' },
        parallelIndex: group.indexOf(r),
        parallelCount: group.length,
        ...withIssue(options.issues?.get(r.id)),
        highlighted: options.highlightIds?.has(r.id) ?? false,
        ...diffMark(options, r.id),
        ...(options.dimmed?.has(r.id) ? { dimmed: true } : {}),
      },
    };
  });
}

/**
 * Change-set mode: shapes and arrows the change removes, where the baseline view had them.
 * They are drawn red and dashed, and cannot be selected or moved (§16.1).
 */
export function toGhosts(
  baseline: Project,
  shown: Project,
  viewId: Id,
  removed: ReadonlySet<Id>,
): { nodes: ShapeFlowNode[]; edges: RelationFlowEdge[] } {
  const view = baseline.views.find((v) => v.id === viewId);
  const live = shown.views.find((v) => v.id === viewId);
  if (!view || !live || removed.size === 0) return { nodes: [], edges: [] };
  const inLive = new Set(live.nodes.map((n) => n.elementId));
  const ghostIds = new Set(
    view.nodes.map((n) => n.elementId).filter((id) => removed.has(id) && !inLive.has(id)),
  );
  const drawn = new Set([...inLive, ...ghostIds]);
  const base = toFlowNodes(baseline, view, {
    compare: { added: new Set(), changed: new Set(), removed },
  });
  const nodes = base
    .filter((n) => ghostIds.has(n.id))
    .map((n): ShapeFlowNode => {
      const parent = n.parentId && drawn.has(n.parentId) ? n.parentId : undefined;
      const position = parent ? n.position : absolutePosition(baseline, view, n.id);
      const { parentId: _p, ...rest } = n;
      return {
        ...rest,
        ...(parent ? { parentId: parent } : {}),
        position,
        draggable: false,
        selectable: false,
        connectable: false,
        className: [n.className, 'ag-ghost'].filter(Boolean).join(' '),
        data: { ...n.data, diff: 'removed', ghost: true },
      };
    });
  const listed = new Set(view.edges.map((e) => e.relationId));
  const edges = toFlowEdges(baseline, view, {
    compare: { added: new Set(), changed: new Set(), removed },
  })
    .filter(
      (e) => removed.has(e.id) && listed.has(e.id) && drawn.has(e.source) && drawn.has(e.target),
    )
    .map((e) => ({ ...e, id: `ghost:${e.id}`, selectable: false, focusable: false }));
  return { nodes, edges };
}

/** Leaves `issue` out of the data when there is none. */
const withIssue = (issue: Issue | undefined) => (issue ? { issue } : {});

function diffMark(options: FlowOptions, id: Id): { diff?: DiffMark } {
  if (options.compare?.added.has(id)) return { diff: 'added' };
  if (options.compare?.changed.has(id)) return { diff: 'changed' };
  if (options.compare?.removed?.has(id)) return { diff: 'removed' };
  return {};
}

// --- annotations -----------------------------------------------------------------------

export type AnnotationNodeData = {
  annotation: Annotation;
  editing: boolean;
  /** Callouts: where the leader line ends, relative to the callout's top-left corner. */
  leader?: { x: number; y: number };
  /** Name of what a callout or comment is attached to. */
  anchorName?: string;
};

export type AnnotationFlowNode = Node<
  AnnotationNodeData,
  'sticky' | 'region' | 'callout' | 'comment'
>;
export type CanvasNode = ShapeFlowNode | AnnotationFlowNode;

const Z_REGION = -100;
const Z_NOTE = 2500;

/** React Flow nodes for a view's annotations. Anchored ones follow their element. */
export function toAnnotationNodes(
  p: Project,
  view: View,
  options: { selectedId?: Id | null; editingId?: Id | null; showResolved?: boolean } = {},
): AnnotationFlowNode[] {
  const out: AnnotationFlowNode[] = [];
  for (const a of view.annotations) {
    if (a.kind === 'comment' && a.resolved && !options.showResolved) continue;
    const base = {
      id: annNodeId(a.id),
      selected: options.selectedId === a.id,
      data: {
        annotation: a,
        editing: options.editingId === a.id,
        ...(anchorLabel(p, a.anchor) ? { anchorName: anchorLabel(p, a.anchor)! } : {}),
      },
    };
    if (a.kind === 'sticky' || a.kind === 'region') {
      if (!('x' in a.anchor)) continue;
      const size = a.kind === 'sticky' ? STICKY_SIZE : REGION_SIZE;
      out.push({
        ...base,
        type: a.kind,
        position: { x: a.anchor.x, y: a.anchor.y },
        width: a.anchor.w ?? size.w,
        height: a.anchor.h ?? size.h,
        zIndex: a.kind === 'region' ? Z_REGION : Z_NOTE,
        ...(a.kind === 'region' ? { dragHandle: '.ag-region-header', className: 'ag-region' } : {}),
      });
      continue;
    }
    const target = anchorBox(p, view, a.anchor);
    if (!target) continue;
    if (a.kind === 'callout') {
      const at = calloutPosition(target);
      out.push({
        ...base,
        type: 'callout',
        position: at,
        draggable: false,
        zIndex: Z_NOTE,
        data: { ...base.data, leader: { x: target.x + target.w / 2 - at.x, y: target.y - at.y } },
      });
    } else {
      const free = 'x' in a.anchor;
      out.push({
        ...base,
        type: 'comment',
        position: free ? { x: target.x, y: target.y } : { x: target.x - 14, y: target.y - 14 },
        draggable: free,
        zIndex: Z_NOTE + 1,
      });
    }
  }
  return out;
}

/** Element ID → accepted or proposed decisions that link to it. */
export function decisionsByElement(p: Project): Map<Id, Id[]> {
  const map = new Map<Id, Id[]>();
  for (const d of p.decisions) {
    if (d.status !== 'accepted' && d.status !== 'proposed') continue;
    for (const id of d.linkedIds) map.set(id, [...(map.get(id) ?? []), d.id]);
  }
  return map;
}
