import type { Edge, Node } from '@xyflow/react';
import type { Id, LineStyle, Project, Relation, ShapeId, Status, View } from '@archguide/core';
import { catalog, conceptOf, shapeFor } from './catalog';
import { colorOf, elementById, isContainer, nodeSize } from './model';

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
};

export type RelationEdgeData = {
  relation: Relation;
  typeName: string;
  line: LineStyle;
  /** Position among relations between the same two elements, so parallel arrows do not overlap. */
  parallelIndex: number;
  parallelCount: number;
};

export type ShapeFlowNode = Node<ShapeNodeData, 'shape'>;
export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

export interface FlowOptions {
  selectedIds?: ReadonlySet<Id>;
  editingId?: Id | null;
  /** While connecting: the source and the elements that may be targets. */
  connecting?: { sourceId: Id; validTargets: ReadonlySet<Id> } | null;
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
        ...(className || container
          ? { className: [className, container ? 'ag-container' : ''].filter(Boolean).join(' ') }
          : {}),
        data: {
          elementId: el.id,
          name: el.name,
          kind: el.kind,
          conceptName: concept?.name ?? el.kind,
          icon: concept?.icon ?? 'box',
          shape: container ? 'container' : shapeFor(el.kind),
          color: colorOf(el),
          w: size.w,
          h: size.h,
          container,
          status: el.status,
          editing: options.editingId === el.id,
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
      },
    };
  });
}
