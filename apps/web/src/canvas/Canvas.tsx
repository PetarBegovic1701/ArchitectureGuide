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
  useStoreApi,
} from '@xyflow/react';
import type {
  Connection,
  EdgeChange,
  NodeChange,
  OnConnectEnd,
  OnSelectionChangeParams,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import { checkNesting, validRelationTypes } from '@archguide/core';
import type { Id, Op } from '@archguide/core';
import { catalog } from '../lib/catalog';
import {
  decisionsByElement,
  toAnnotationNodes,
  toFlowEdges,
  toFlowNodes,
  toGhosts,
} from '../lib/flow';
import { useOverlay } from '../lib/changesets';
import { dimmedIds } from '../lib/focus';
import { recordStep } from '../panels/Views';
import { ownershipColors } from '../lib/ownership';
import { annIdOf } from '../lib/annotations';
import { annotationNodeTypes } from './AnnotationNodes';
import { findingKey, findingsOf, issuesByItem } from '../lib/findings';
import type { CanvasNode, RelationFlowEdge, ShapeFlowNode } from '../lib/flow';
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
  connectModeTap,
  dispatch,
  refuseConnection,
  startConnecting,
} from '../actions';
import { useScreen } from '../hooks';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { EdgeMarkers, RelationEdge } from './RelationEdge';
import { ShapeNode } from './ShapeNode';

const nodeTypes = { shape: ShapeNode, ...annotationNodeTypes };
const NO_FINDINGS: never[] = [];
const edgeTypes = { relation: RelationEdge };
export const DRAG_MIME = 'application/archguide-kind';

export function Canvas() {
  const project = useProject((s) => s.project);
  const viewId = useProject((s) => s.viewId);
  const selection = useProject((s) => s.selection);
  const editingId = useUi((s) => s.editingId);
  const connecting = useUi((s) => s.connecting);
  const connectMode = useUi((s) => s.connectMode);
  const multiSelect = useUi((s) => s.multiSelect);
  const screen = useScreen();
  const flow = useReactFlow();
  const store = useStoreApi();
  const pointer = useRef({ x: 0, y: 0 });
  const wrapper = useRef<HTMLDivElement>(null);
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);

  // "Select several" on touch: taps add to the selection, like Shift+click.
  useEffect(() => store.setState({ multiSelectionActive: multiSelect }), [store, multiSelect]);

  const view = project ? activeView(project, viewId) : undefined;
  const ownershipOn = useUi((s) => s.ownership) || view?.kind === 'database';
  const ownership = useMemo(
    () => (project && ownershipOn ? ownershipColors(project).colors : null),
    [project, ownershipOn],
  );
  const selectedIds = useMemo(
    () => new Set([...selection.elements, ...selection.relations]),
    [selection],
  );
  const level = useUi((s) => s.level);
  const activeFinding = useUi((s) => s.activeFinding);
  const snapshotCompare = useUi((s) => s.compare);
  // Change-set mode: the overlay (added, changed, removed) wins over a snapshot compare.
  const overlay = useOverlay();
  const compare = useMemo(
    () =>
      overlay ??
      (snapshotCompare ? { added: snapshotCompare.added, changed: snapshotCompare.changed } : null),
    [overlay, snapshotCompare],
  );
  const baseline = useProject((s) => s.baseline);
  const focusDepth = useUi((s) => s.focusDepth);
  const filters = useUi((s) => s.filters);
  const dimmed = useMemo(
    () =>
      project
        ? dimmedIds(project, {
            focus: focusDepth ? { ids: selection.elements, depth: focusDepth } : null,
            filters,
          })
        : null,
    [project, focusDepth, selection.elements, filters],
  );
  const ghosts = useMemo(
    () =>
      overlay && baseline && project
        ? toGhosts(baseline, project, viewId, overlay.removed)
        : { nodes: [], edges: [] },
    [overlay, baseline, project, viewId],
  );
  const selectedAnnotation = useUi((s) => s.selectedAnnotation);
  const editingAnnotation = useUi((s) => s.editingAnnotation);
  const showResolved = useUi((s) => s.showResolvedComments);
  const findings = project ? findingsOf(project) : NO_FINDINGS;
  const issues = useMemo(() => issuesByItem(findings, level), [findings, level]);
  const tourState = useUi((s) => s.tour);
  const lessonFocus = useUi((s) => s.lessonFocus);
  const playStep = useUi((s) => s.playStep);
  const recording = useUi((s) => s.recording);
  const highlightIds = useMemo(() => {
    const f = activeFinding ? findings.find((x) => findingKey(x) === activeFinding) : undefined;
    const step =
      tourState && project?.tours.find((t) => t.id === tourState.id)?.steps[tourState.step];
    // Scenario playback: the arrow of the current step and its two ends.
    const scenarioStep =
      view?.kind === 'scenario' && playStep !== null ? view.scenario?.steps[playStep] : undefined;
    const stepRelation = scenarioStep
      ? project?.model.relations.find((r) => r.id === scenarioStep.relationId)
      : undefined;
    return new Set<Id>([
      ...(f ? [...f.targetIds, ...f.relatedIds] : []),
      ...(step ? [...step.elementIds, ...step.relationIds] : []),
      ...(stepRelation ? [stepRelation.id, stepRelation.sourceId, stepRelation.targetId] : []),
      ...lessonFocus,
    ]);
  }, [findings, activeFinding, tourState, project, lessonFocus, view, playStep]);
  const derivedNodes = useMemo((): CanvasNode[] => {
    if (!project || !view) return [];
    const shapes = toFlowNodes(project, view, {
      selectedIds,
      editingId,
      connecting,
      issues,
      highlightIds,
      compare,
      dimmed,
      decisions: decisionsByElement(project),
      ownership,
    });
    const notes = toAnnotationNodes(project, view, {
      selectedId: selectedAnnotation,
      editingId: editingAnnotation,
      showResolved,
    });
    // Regions behind the shapes, notes and comments in front.
    return [
      ...notes.filter((n) => n.type === 'region'),
      ...ghosts.nodes.filter((n) => !n.parentId),
      ...shapes,
      ...ghosts.nodes.filter((n) => n.parentId),
      ...notes.filter((n) => n.type !== 'region'),
    ];
  }, [
    project,
    view,
    selectedIds,
    editingId,
    connecting,
    issues,
    highlightIds,
    compare,
    dimmed,
    ghosts,
    ownership,
    selectedAnnotation,
    editingAnnotation,
    showResolved,
  ]);
  const derivedEdges = useMemo(
    () =>
      project && view
        ? [
            ...toFlowEdges(project, view, { selectedIds, issues, highlightIds, compare, dimmed }),
            ...ghosts.edges,
          ]
        : [],
    [project, view, selectedIds, issues, highlightIds, compare, dimmed, ghosts],
  );

  // Local copies, so dragging and selecting are smooth. The model changes once, on drag
  // stop; selection reaches the store through onSelectionChange.
  const [nodes, setNodes] = useState<CanvasNode[]>(derivedNodes);
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
    // Fits the whole diagram, captures the canvas (without minimap and controls), and
    // restores the view. The arrowhead definitions live outside React Flow's viewport, so
    // the whole canvas is captured, not only the viewport.
    canvasApi.exportImage = async (format) => {
      const el = wrapper.current;
      if (!el) throw new Error('The canvas is not ready.');
      const before = flow.getViewport();
      await flow.fitView({ padding: 0.08, duration: 0 });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const options = {
        backgroundColor:
          getComputedStyle(document.body).getPropertyValue('--ag-bg').trim() || '#ffffff',
        pixelRatio: 2,
        filter: (node: HTMLElement) =>
          !node.classList?.contains('react-flow__minimap') &&
          !node.classList?.contains('react-flow__controls') &&
          !node.classList?.contains('react-flow__attribution'),
      };
      try {
        return format === 'png' ? await toPng(el, options) : await toSvg(el, options);
      } finally {
        void flow.setViewport(before);
      }
    };
    canvasApi.focus = (ids) =>
      void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 300, maxZoom: 1.2 });
    // A new shape must be visible: if it landed outside the visible area, fit the whole
    // diagram. Retries each frame until React Flow has rendered and measured the shape.
    canvasApi.reveal = (id) => {
      let frames = 0;
      const attempt = () => {
        const node = flow.getInternalNode(id);
        const box = wrapper.current?.getBoundingClientRect();
        const w = node?.measured.width;
        const h = node?.measured.height;
        if (!node || !box || !w || !h) {
          if (++frames < 60) requestAnimationFrame(attempt);
          return;
        }
        const { x, y } = node.internals.positionAbsolute;
        const topLeft = flow.flowToScreenPosition({ x, y });
        const bottomRight = flow.flowToScreenPosition({ x: x + w, y: y + h });
        const visible =
          topLeft.x >= box.left &&
          topLeft.y >= box.top &&
          bottomRight.x <= box.right &&
          bottomRight.y <= box.bottom;
        if (!visible) void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
      };
      requestAnimationFrame(attempt);
    };
  }, [flow]);

  // Removal goes through ops (deleteKeyCode is off), so every change here is view-local.
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<RelationFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);

  const syncSelection = useCallback(({ nodes: n, edges: e }: OnSelectionChangeParams) => {
    const annotation = n.map((x) => annIdOf(x.id)).find(Boolean) ?? null;
    if (annotation !== useUi.getState().selectedAnnotation)
      useUi.getState().set({ selectedAnnotation: annotation });
    const elements = n.map((x) => x.id).filter((id) => !annIdOf(id));
    const relations = e.map((x) => x.id);
    const current = useProject.getState().selection;
    if (same(current.elements, elements) && same(current.relations, relations)) return;
    useProject.getState().select({ elements, relations });
    if (useUi.getState().learnTarget.kind !== 'selection')
      useUi.getState().set({ learnTarget: { kind: 'selection' } });
  }, []);
  // While a selection box is drawn, React Flow keeps the selection; the store gets it once
  // the box is let go. Syncing on every move rebuilds the nodes mid-drag and loops.
  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      if (!store.getState().userSelectionActive) syncSelection(params);
    },
    [store, syncSelection],
  );
  const onSelectionEnd = useCallback(() => {
    // After React Flow has applied the last change of the box.
    setTimeout(() =>
      syncSelection({
        nodes: flow.getNodes().filter((n) => n.selected),
        edges: flow.getEdges().filter((e) => e.selected),
      }),
    );
  }, [flow, syncSelection]);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: CanvasNode, dragged: CanvasNode[]) => {
      const p = useProject.getState().project;
      if (!p || !view) return;
      const ops: Op[] = [];
      // Sticky notes, regions and free comments keep their new position.
      for (const d of dragged) {
        const annotationId = annIdOf(d.id);
        const a = annotationId && view.annotations.find((x) => x.id === annotationId);
        if (!a || !('x' in a.anchor)) continue;
        ops.push({
          op: 'upsertAnnotation',
          viewId: view.id,
          annotation: {
            ...a,
            anchor: { ...a.anchor, x: snap(d.position.x), y: snap(d.position.y) },
          },
        });
      }
      dragged = dragged.filter((d) => !annIdOf(d.id));
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
    if (!p || c.source === c.target || annIdOf(c.source) || annIdOf(c.target)) return false;
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

  const openMenu = (kind: 'element' | 'relation', id: Id, x: number, y: number) =>
    useUi.getState().set({ contextMenu: { kind, id, x, y }, picker: null });

  /** Long-press on a shape or an arrow opens its context menu (touch has no right-click). */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const target = e.target as HTMLElement;
    const nodeId = target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    const edgeId = target.closest<HTMLElement>('.react-flow__edge')?.dataset.id;
    const kind = nodeId && !annIdOf(nodeId) ? 'element' : edgeId ? 'relation' : undefined;
    if (!kind) return;
    const { clientX: x, clientY: y } = e;
    longPress.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        longPress.current = null;
        openMenu(kind, (nodeId ?? edgeId)!, x, y);
      }, 500),
    };
  };
  const cancelLongPress = (e?: React.PointerEvent) => {
    const lp = longPress.current;
    if (!lp) return;
    if (e && e.type === 'pointermove' && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) < 8) return;
    window.clearTimeout(lp.timer);
    longPress.current = null;
  };

  if (!project || !view) return null;

  return (
    <div
      ref={wrapper}
      className={`relative h-full w-full ${connecting ? 'ag-connecting' : ''} ${connectMode ? 'ag-connect-mode' : ''}`}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        cancelLongPress(e);
      }}
      onPointerDownCapture={onPointerDown}
      onPointerUp={() => cancelLongPress()}
      onPointerCancel={() => cancelLongPress()}
      data-testid="canvas"
    >
      <EdgeMarkers />
      <ReactFlow<CanvasNode, RelationFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onSelectionEnd={onSelectionEnd}
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
        onPaneClick={() =>
          useUi.getState().set({
            picker: null,
            activeFinding: null,
            openComment: null,
            contextMenu: null,
            panel: null,
          })
        }
        onEdgeClick={(_, edge) => {
          // After React Flow has handled the click; nothing is selected while recording.
          if (recording && view?.kind === 'scenario' && !edge.id.startsWith('ghost:'))
            setTimeout(() => recordStep(edge.id), 0);
        }}
        onNodeClick={(e, node) => {
          if (connectMode && node.type === 'shape')
            connectModeTap(node.id, { x: e.clientX, y: e.clientY });
          // React Flow toggles on any multi-selection key; here Shift+click always adds
          // and Ctrl/⌘+click always removes. Runs after React Flow's own change.
          const add = e.shiftKey;
          const remove = !add && (e.ctrlKey || e.metaKey);
          if (add || remove)
            store.getState().triggerNodeChanges([{ id: node.id, type: 'select', selected: add }]);
        }}
        onNodeContextMenu={(e, node) => {
          if (node.type !== 'shape') return;
          e.preventDefault();
          openMenu('element', node.id, e.clientX, e.clientY);
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          openMenu('relation', edge.id, e.clientX, e.clientY);
        }}
        nodesDraggable={!connectMode}
        elementsSelectable={!connectMode && !(recording && view?.kind === 'scenario')}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={40}
        snapToGrid
        snapGrid={[8, 8]}
        deleteKeyCode={null}
        // Alt+drag draws a selection box; Shift+click adds, Ctrl/⌘+click removes.
        selectionKeyCode="Alt"
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        fitView
        fitViewOptions={{ maxZoom: 1.1, padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {screen !== 'phone' && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              n.type === 'shape' ? (n.data as ShapeFlowNode['data']).color : 'transparent'
            }
          />
        )}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** The topmost canvas shape at a screen point, other than `except`. */
function nodeAt(x: number, y: number, except: string): string | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (id && id !== except && !annIdOf(id)) return id;
  }
  return undefined;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
