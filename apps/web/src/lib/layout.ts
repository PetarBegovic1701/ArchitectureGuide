import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Id, Op, Project, View } from '@archguide/core';
import {
  CONTAINER_HEADER,
  CONTAINER_PADDING,
  elementById,
  isContainer,
  nodeSize,
  snap,
} from './model';

/**
 * Automatic layout with ELK (Implementation.md §13.3): layered, left to right, with
 * containers laid out around their children. The graph is built here and laid out by ELK
 * in a Web Worker (see `tidyUp`).
 */
const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'SPLINES',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.componentComponent': '60',
};

const CONTAINER_OPTIONS: Record<string, string> = {
  'elk.padding': `[top=${CONTAINER_HEADER + 8},left=${CONTAINER_PADDING},bottom=${CONTAINER_PADDING},right=${CONTAINER_PADDING}]`,
};

/** The ELK graph of a view: shown elements nested like on the canvas, shown relations as edges. */
export function toElkGraph(p: Project, view: View): ElkNode {
  const shown = new Set(view.nodes.map((n) => n.elementId));
  const parentOf = (id: Id): Id | undefined => {
    const parent = elementById(p, id)?.parentId;
    return parent && shown.has(parent) ? parent : undefined;
  };
  const build = (id: Id): ElkNode => {
    const children = view.nodes
      .filter((n) => parentOf(n.elementId) === id)
      .map((n) => build(n.elementId));
    if (children.length > 0 || isContainer(p, view, id))
      return { id, children, layoutOptions: CONTAINER_OPTIONS };
    const size = nodeSize(p, view, id);
    return { id, width: size.w, height: size.h };
  };
  const listed = new Set(view.edges.map((e) => e.relationId));
  const edges: ElkExtendedEdge[] = p.model.relations
    .filter((r) => listed.has(r.id) && shown.has(r.sourceId) && shown.has(r.targetId))
    .filter((r) => r.sourceId !== r.targetId)
    .map((r) => ({ id: r.id, sources: [r.sourceId], targets: [r.targetId] }));
  return {
    id: '__root__',
    layoutOptions: LAYOUT_OPTIONS,
    children: view.nodes.filter((n) => !parentOf(n.elementId)).map((n) => build(n.elementId)),
    edges,
  };
}

/**
 * View-node ops from a laid-out graph. ELK positions children relative to their parent,
 * like the canvas does; top-level positions are shifted to start at `origin`.
 */
export function layoutOps(view: View, laid: ElkNode, origin = { x: 40, y: 40 }): Op[] {
  const ops: Op[] = [];
  const nodes = new Map(view.nodes.map((n) => [n.elementId, n]));
  const visit = (n: ElkNode, top: boolean) => {
    const node = nodes.get(n.id);
    if (node) {
      const x = snap((n.x ?? 0) + (top ? origin.x : 0));
      const y = snap((n.y ?? 0) + (top ? origin.y : 0));
      // Sizes stay automatic: containers grow around their children.
      const { w: _w, h: _h, ...rest } = node;
      ops.push({ op: 'setViewNode', viewId: view.id, node: { ...rest, x, y } });
    }
    for (const child of n.children ?? []) visit(child, false);
  };
  for (const child of laid.children ?? []) visit(child, true);
  return ops;
}
