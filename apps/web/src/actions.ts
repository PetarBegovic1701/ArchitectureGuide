import {
  checkNesting,
  explainPair,
  makeElementId,
  parseProject,
  serializeProject,
  validRelationTypes,
} from '@archguide/core';
import type { Id, Op, OpError, Project } from '@archguide/core';
import { catalog, conceptOf, defaultSize } from './lib/catalog';
import { copySelection, pasteOps } from './lib/clipboard';
import {
  absolutePosition,
  activeView,
  deleteOps,
  nodeSize,
  elementById,
  newElementOps,
  newRelationOps,
  takenIds,
} from './lib/model';
import type { Point } from './lib/model';
import { useProject } from './store/project';
import { useUi } from './store/ui';

/** Set by the canvas: converts screen to flow coordinates and knows the visible center. */
export const canvasApi: {
  screenToFlow?: (p: Point) => Point;
  center?: () => Point;
  focus?: (ids: Id[]) => void;
  reveal?: (id: Id) => void;
} = {};

const project = () => useProject.getState();
const ui = () => useUi.getState();

function reportErrors(errors: OpError[]): boolean {
  const first = errors[0];
  if (!first) return false;
  ui().toast({ tone: 'error', message: first.message });
  return true;
}

export function dispatch(ops: Op[], meta?: { label?: string; mergeKey?: string }): boolean {
  return !reportErrors(project().dispatch(ops, meta));
}

/** Adds an element at a point (flow coordinates), nesting it into the container below the point. */
export function addElementAt(
  kind: string,
  point: Point,
  options: { parentId?: Id; topLevel?: boolean } = {},
): Id | undefined {
  const { project: p, viewId } = project();
  if (!p) return undefined;
  const view = activeView(p, viewId);
  const result = newElementOps(p, view, kind, point, options);
  if (result.error) {
    ui().toast({
      tone: 'error',
      message: result.error,
      actions: [{ label: 'Why?', run: () => ui().openLearn({ kind: 'doc', id: kind }) }],
    });
    return undefined;
  }
  if (
    !dispatch(result.ops, {
      label: `Add ${conceptOf(kind)?.name ?? kind}`,
      mergeKey: `create:${result.id}`,
    })
  )
    return undefined;
  project().select({ elements: [result.id], relations: [] });
  ui().set({ editingId: result.id, freshIds: [...ui().freshIds, result.id] });
  canvasApi.reveal?.(result.id);
  return result.id;
}

/**
 * Adds an element from the palette by click: inside the selected element when it accepts
 * the concept, otherwise in a free spot near the center of the screen.
 */
export function addElementFromPalette(kind: string): Id | undefined {
  const { project: p, selection } = project();
  if (!p) return undefined;
  const view = activeView(p, project().viewId);
  const selected =
    selection.elements.length === 1 ? elementById(p, selection.elements[0]!) : undefined;
  if (selected && checkNesting(catalog, kind, selected.kind).ok) {
    return addElementAt(kind, canvasApi.center?.() ?? { x: 0, y: 0 }, { parentId: selected.id });
  }
  // Next to what the user is working on: the selected shape, or the target of the selected arrow.
  const relation =
    selection.relations.length === 1
      ? p.model.relations.find((r) => r.id === selection.relations[0])
      : undefined;
  const anchorId = selected?.id ?? relation?.targetId;
  if (anchorId && view.nodes.some((n) => n.elementId === anchorId)) {
    const pos = absolutePosition(p, view, anchorId);
    const size = nodeSize(p, view, anchorId);
    const own = defaultSize(kind);
    return addElementAt(
      kind,
      { x: pos.x + size.w + 48 + own.w / 2, y: pos.y + size.h / 2 },
      { topLevel: true },
    );
  }
  return addElementAt(kind, canvasApi.center?.() ?? { x: 200, y: 200 });
}

/** Finishes an inline rename. A fresh element also gets an ID that follows its new name. */
export function renameElement(id: Id, name: string): void {
  const { project: p } = project();
  const el = p && elementById(p, id);
  ui().set({ editingId: null });
  const trimmed = name.trim();
  if (!p || !el || !trimmed || trimmed === el.name) return;
  const ops: Op[] = [{ op: 'updateElement', id, patch: { name: trimmed } }];
  const fresh = ui().freshIds.includes(id);
  const concept = conceptOf(el.kind);
  let newId = id;
  if (fresh && concept) {
    const taken = takenIds(p);
    taken.delete(id);
    newId = makeElementId(concept.idPrefix, trimmed, taken);
    if (newId !== id) ops.push({ op: 'renameId', from: id, to: newId });
  }
  if (dispatch(ops, { label: 'Rename', mergeKey: `create:${id}` })) {
    if (newId !== id) {
      ui().set({ freshIds: ui().freshIds.map((x) => (x === id ? newId : x)) });
      project().select({ elements: [newId], relations: [] });
    }
  }
}

function pairKey(sourceKind: string, targetKind: string) {
  return `${sourceKind}→${targetKind}`;
}

/** Valid types for a pair, with the type picked last time for this pair first. */
export function rankedTypes(sourceKind: string, targetKind: string) {
  const types = validRelationTypes(catalog, sourceKind, targetKind);
  const preferred = ui().preferredTypes[pairKey(sourceKind, targetKind)];
  const index = types.findIndex((t) => t.id === preferred);
  return index > 0 ? [types[index]!, ...types.slice(0, index), ...types.slice(index + 1)] : types;
}

/** Called when a connection is dropped on a valid target (Implementation.md §10.5). */
export function connect(sourceId: Id, targetId: Id, at: Point): void {
  const { project: p } = project();
  const source = p && elementById(p, sourceId);
  const target = p && elementById(p, targetId);
  if (!p || !source || !target) return;
  const types = rankedTypes(source.kind, target.kind);
  if (types.length === 1) createRelation(sourceId, targetId, types[0]!.id);
  else if (types.length > 1) ui().set({ picker: { sourceId, targetId, types, x: at.x, y: at.y } });
}

export function createRelation(sourceId: Id, targetId: Id, type: string): Id | undefined {
  const { project: p, viewId } = project();
  const source = p && elementById(p, sourceId);
  const target = p && elementById(p, targetId);
  if (!p || !source || !target) return undefined;
  const { ops, id } = newRelationOps(p, activeView(p, viewId), type, sourceId, targetId);
  ui().set({ picker: null });
  if (!dispatch(ops, { label: `Connect: ${type}` })) return undefined;
  ui().preferType(pairKey(source.kind, target.kind), type);
  project().select({ elements: [], relations: [id] });
  return id;
}

/** Called when a connection is dropped on a target that no relation type allows. */
export function refuseConnection(sourceId: Id, targetId: Id): void {
  const { project: p } = project();
  const source = p && elementById(p, sourceId);
  const target = p && elementById(p, targetId);
  if (!p || !source || !target || sourceId === targetId) return;
  const explanation = explainPair(catalog, source.kind, target.kind);
  const actions = [];
  if (explanation.flip) {
    const flip = explanation.flip;
    actions.push({ label: 'Reverse it', run: () => createRelation(targetId, sourceId, flip) });
  }
  actions.push({
    label: 'Why?',
    run: () =>
      ui().openLearn({
        kind: 'refusal',
        sourceKind: source.kind,
        targetKind: target.kind,
        message: explanation.message,
      }),
  });
  ui().toast({ tone: 'error', message: explanation.message, actions });
}

export function startConnecting(sourceId: Id): void {
  const { project: p, viewId } = project();
  const source = p && elementById(p, sourceId);
  if (!p || !source) return;
  const view = activeView(p, viewId);
  const valid = new Set<Id>();
  for (const node of view.nodes) {
    const el = elementById(p, node.elementId);
    if (el && el.id !== sourceId && validRelationTypes(catalog, source.kind, el.kind).length > 0)
      valid.add(el.id);
  }
  ui().set({ connecting: { sourceId, validTargets: valid } });
}

export function deleteSelection(): void {
  const { project: p, selection } = project();
  if (!p) return;
  const ops = deleteOps(p, selection.elements, selection.relations);
  if (ops.length > 0) dispatch(ops, { label: 'Delete' });
}

export function copy(): void {
  const { project: p, viewId, selection } = project();
  if (!p) return;
  const data = copySelection(p, activeView(p, viewId), selection.elements);
  if (data) ui().set({ clipboard: data });
}

export function paste(): void {
  const { project: p, viewId } = project();
  const data = ui().clipboard;
  if (!p || !data) return;
  const { ops, ids } = pasteOps(p, activeView(p, viewId), data);
  if (dispatch(ops, { label: 'Paste' })) {
    project().select({ elements: ids, relations: [] });
    // Paste again → the next copy lands further away instead of on top.
    ui().set({
      clipboard: { ...data, nodes: data.nodes.map((n) => ({ ...n, x: n.x + 32, y: n.y + 32 })) },
    });
  }
}

export function duplicate(): void {
  copy();
  paste();
}

export function undo(): void {
  project().undo();
}

export function redo(): void {
  project().redo();
}

export function exportJson(p: Project): void {
  download(`${p.id}.archguide.json`, serializeProject(p), 'application/json');
}

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file: File): Promise<Project> {
  return parseProject(await file.text());
}
