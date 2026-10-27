import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import type {
  Connection,
  EdgeChange,
  NodeChange,
  OnConnectEnd,
  OnSelectionChangeParams,
} from '@xyflow/react';
import { checkNesting, validRelationTypes } from '@archguide/core';
import type { Id, Op } from '@archguide/core';
import { catalog } from '../lib/catalog';
import { toFlowEdges, toFlowNodes } from '../lib/flow';
import type { RelationFlowEdge, ShapeFlowNode } from '../lib/flow';
import {
  activeView,
  descendantIds,
  elementById,
  findDropParent,
  reparentOps,
  snap,
} from '../lib/model';
import {
  addElementAt,
  canvasApi,
  connect,
  dispatch,
  refuseConnection,
  startConnecting,
} from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { EdgeMarkers, RelationEdge } from './RelationEdge';
import { ShapeNode } from './ShapeNode';

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { relation: RelationEdge };
export const DRAG_MIME = 'application/archguide-kind';

export function Canvas() {
  const project = useProject((s) => s.project);
  const viewId = useProject((s) => s.viewId);
  const selection = useProject((s) => s.selection);
  const editingId = useUi((s) => s.editingId);
  const connecting = useUi((s) => s.connecting);
  const flow = useReactFlow();
  const pointer = useRef({ x: 0, y: 0 });
  const wrapper = useRef<HTMLDivElement>(null);

  const view = project ? activeView(project, viewId) : undefined;
  const selectedIds = useMemo(
    () => new Set([...selection.elements, ...selection.relations]),
    [selection],
  );
  const derivedNodes = useMemo(
    () =>
      project && view ? toFlowNodes(project, view, { selectedIds, editingId, connecting }) : [],
    [project, view, selectedIds, editingId, connecting],
  );
  const derivedEdges = useMemo(
    () => (project && view ? toFlowEdges(project, view, { selectedIds }) : []),
    [project, view, selectedIds],
  );

  // Local copies, so dragging and selecting are smooth. The model changes once, on drag
  // stop; selection reaches the store through onSelectionChange.
  const [nodes, setNodes] = useState<ShapeFlowNode[]>(derivedNodes);
  const [edges, setEdges] = useState<RelationFlowEdge[]>(derivedEdges);
  useEffect(() => setNodes(derivedNodes), [derivedNodes]);
  useEffect(() => setEdges(derivedEdges), [derivedEdges]);

  useEffect(() => {
    canvasApi.screenToFlow = (p) => flow.screenToFlowPosition(p);
    canvasApi.center = () => {
      const box = wrapper.current?.getBoundingClientRect();
      return box
        ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
        : { x: 0, y: 0 };
    };
    canvasApi.focus = (ids) =>
      void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 300, maxZoom: 1.2 });
    // A new shape must be visible: if it landed outside the visible area, fit the whole
    // diagram. Waits a moment so React Flow has rendered and measured the new node.
    canvasApi.reveal = (id) =>
      void setTimeout(() => {
        const node = flow.getInternalNode(id);
        const box = wrapper.current?.getBoundingClientRect();
        if (!node || !box) return;
        const { x, y } = node.internals.positionAbsolute;
        const w = node.measured.width ?? node.width ?? 0;
        const h = node.measured.height ?? node.height ?? 0;
        const topLeft = flow.flowToScreenPosition({ x, y });
        const bottomRight = flow.flowToScreenPosition({ x: x + w, y: y + h });
        const visible =
          topLeft.x >= box.left &&
          topLeft.y >= box.top &&
          bottomRight.x <= box.right &&
          bottomRight.y <= box.bottom;
        if (!visible) void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
      }, 60);
  }, [flow]);

  // Removal goes through ops (deleteKeyCode is off), so every change here is view-local.
  const onNodesChange = useCallback((changes: NodeChange<ShapeFlowNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<RelationFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const onSelectionChange = useCallback(({ nodes: n, edges: e }: OnSelectionChangeParams) => {
    const elements = n.map((x) => x.id);
    const relations = e.map((x) => x.id);
    const current = useProject.getState().selection;
    if (same(current.elements, elements) && same(current.relations, relations)) return;
    useProject.getState().select({ elements, relations });
    if (useUi.getState().learnTarget.kind !== 'selection')
      useUi.getState().set({ learnTarget: { kind: 'selection' } });
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: ShapeFlowNode, dragged: ShapeFlowNode[]) => {
      const p = useProject.getState().project;
      if (!p || !view) return;
      const ops: Op[] = [];
      const draggedIds = new Set(dragged.map((d) => d.id));
      for (const d of dragged) {
        const el = elementById(p, d.id);
        if (!el) continue;
        // Children dragged together with their parent keep their place inside it.
        if (el.parentId && draggedIds.has(el.parentId)) continue;
        const internal = flow.getInternalNode(d.id);
        const abs = internal?.internals.positionAbsolute ?? d.position;
        const w = d.width ?? 0;
        const h = d.height ?? 0;
        const centerPoint = { x: abs.x + w / 2, y: abs.y + h / 2 };
        const exclude = new Set<Id>([d.id, ...descendantIds(p, d.id)]);
        const parent = findDropParent(p, view, centerPoint, el.kind, exclude);
        if (!parent && !checkNesting(catalog, el.kind, null).ok) {
          const result = checkNesting(catalog, el.kind, null);
          useUi.getState().toast({ tone: 'error', message: result.ok ? '' : result.message });
          setNodes(derivedNodes);
          return;
        }
        const parentId = parent?.id ?? null;
        if (parentId === (el.parentId ?? null)) {
          const node = view.nodes.find((n) => n.elementId === d.id)!;
          ops.push({
            op: 'setViewNode',
            viewId: view.id,
            node: { ...node, x: snap(d.position.x), y: snap(d.position.y) },
          });
        } else {
          ops.push(...reparentOps(p, view, d.id, parentId, abs));
        }
      }
      if (ops.length && !dispatch(ops, { label: 'Move' })) setNodes(derivedNodes);
    },
    [flow, view, derivedNodes],
  );

  const isValidConnection = useCallback((c: Connection | { source: string; target: string }) => {
    const p = useProject.getState().project;
    if (!p || c.source === c.target) return false;
    const s = elementById(p, c.source);
    const t = elementById(p, c.target);
    return !!s && !!t && validRelationTypes(catalog, s.kind, t.kind).length > 0;
  }, []);

  const onConnect = useCallback((c: Connection) => {
    connect(c.source, c.target, pointer.current);
  }, []);

  /**
   * React Flow only finds a target when the pointer is near one of its handles. A drop
   * anywhere on a shape should count, so without a target we use the shape under the pointer.
   */
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      useUi.getState().set({ connecting: null });
      const point = 'changedTouches' in event ? event.changedTouches[0]! : (event as MouseEvent);
      pointer.current = { x: point.clientX, y: point.clientY };
      const sourceId = state.fromNode?.id;
      if (!sourceId || state.isValid) return; // valid drops were handled by onConnect
      const targetId = state.toNode?.id ?? nodeAt(point.clientX, point.clientY, sourceId);
      if (!targetId || targetId === sourceId) return;
      if (isValidConnection({ source: sourceId, target: targetId }))
        connect(sourceId, targetId, pointer.current);
      else refuseConnection(sourceId, targetId);
    },
    [isValidConnection],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DRAG_MIME);
      if (!kind) return;
      addElementAt(kind, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [flow],
  );

  if (!project || !view) return null;

  return (
    <div
      ref={wrapper}
      className={`relative h-full w-full ${connecting ? 'ag-connecting' : ''}`}
      onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      data-testid="canvas"
    >
      <EdgeMarkers />
      <ReactFlow<ShapeFlowNode, RelationFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={onNodeDragStop}
        onConnectStart={(_, { nodeId }) => nodeId && startConnecting(nodeId)}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onPaneClick={() => useUi.getState().set({ picker: null })}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        snapToGrid
        snapGrid={[8, 8]}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Control']}
        fitView
        fitViewOptions={{ maxZoom: 1.1, padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <MiniMap pannable zoomable nodeColor={(n) => (n.data as ShapeFlowNode['data']).color} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** The topmost canvas shape at a screen point, other than `except`. */
function nodeAt(x: number, y: number, except: string): string | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (id && id !== except) return id;
  }
  return undefined;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
