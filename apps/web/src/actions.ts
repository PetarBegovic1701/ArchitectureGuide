import {
  databaseViewOps,
  RULE_PACKS,
  applyOps,
  checkNesting,
  explainPair,
  makeElementId,
  parseProject,
  serializeProject,
  serializeTemplateFile,
  validRelationTypes,
} from '@archguide/core';
import type {
  Annotation,
  ConceptLink,
  Finding,
  Id,
  Op,
  OpError,
  Project,
  QuickFix,
  Template,
  TemplateFile,
} from '@archguide/core';
import { catalog, conceptOf, defaultSize } from './lib/catalog';
import { copySelection, pasteOps } from './lib/clipboard';
import { findingKey, findingsOf, focusIds, quickFixOps } from './lib/findings';
import { stampOps, stampOrigin } from './lib/templates';
import { STICKY_SIZE, anchoredOps, regionOps, stickyOps } from './lib/annotations';
import { layoutOps, toElkGraph } from './lib/layout';
import { alignOps, alignProblem, distributeOps } from './lib/align';
import type { Alignment, Distribution } from './lib/align';
import ELK from 'elkjs/lib/elk-api.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import {
  absolutePosition,
  activeView,
  deleteOps,
  nodeSize,
  elementById,
  freeSpot,
  newElementOps,
  newRelationOps,
  snap,
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
  /** The whole diagram as a PNG or SVG data URL. */
  exportImage?: (format: 'png' | 'svg') => Promise<string>;
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

/**
 * Adds a shape of `link.kind` next to `anchorId` and connects the two with `link.type`, in
 * one undo step (concept guides, Implementation.md §13.11). With `existingId`, only connects.
 * The anchor stays selected, so its guide stays open for the next connection.
 */
export function addConnected(
  anchorId: Id,
  link: Pick<ConceptLink, 'direction' | 'type' | 'kind'>,
  existingId?: Id,
): Id | undefined {
  const { project: p, viewId } = project();
  const anchor = p && elementById(p, anchorId);
  if (!p || !anchor) return undefined;
  const view = activeView(p, viewId);
  const ops: Op[] = [];
  let partnerId = existingId;
  if (!partnerId) {
    // In the anchor's container when the concept may live there, else the nearest
    // container above that accepts it, else top level.
    let parentId = anchor.parentId;
    while (parentId && !checkNesting(catalog, link.kind, elementById(p, parentId)!.kind).ok)
      parentId = elementById(p, parentId)?.parentId;
    const shown = view.nodes.some((n) => n.elementId === anchorId);
    const pos = shown
      ? absolutePosition(p, view, anchorId)
      : (canvasApi.center?.() ?? { x: 0, y: 0 });
    const size = shown ? nodeSize(p, view, anchorId) : { w: 0, h: 0 };
    const own = defaultSize(link.kind);
    const gap = 64;
    const point =
      link.direction === 'out'
        ? { x: pos.x + size.w + gap + own.w / 2, y: pos.y + size.h / 2 }
        : { x: pos.x - gap - own.w / 2, y: pos.y + size.h / 2 };
    const result = newElementOps(
      p,
      view,
      link.kind,
      point,
      parentId ? { parentId } : { topLevel: true },
    );
    if (result.error) {
      ui().toast({
        tone: 'error',
        message: result.error,
        actions: [{ label: 'Why?', run: () => ui().openLearn({ kind: 'doc', id: link.kind }) }],
      });
      return undefined;
    }
    ops.push(...result.ops);
    partnerId = result.id;
  }
  const [sourceId, targetId] =
    link.direction === 'out' ? [anchorId, partnerId] : [partnerId, anchorId];
  ops.push(...newRelationOps(p, view, link.type, sourceId, targetId).ops);
  const partnerName = conceptOf(link.kind)?.name ?? link.kind;
  if (!dispatch(ops, { label: existingId ? `Connect: ${link.type}` : `Add ${partnerName}` }))
    return undefined;
  if (!existingId) {
    ui().set({ freshIds: [...ui().freshIds, partnerId] });
    canvasApi.reveal?.(partnerId);
  }
  return partnerId;
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
      // A reveal scheduled for the old ID finds nothing once it is renamed.
      canvasApi.reveal?.(newId);
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

// --- connect mode (touch, or the C key) ----------------------------------------------

/** Starts connect mode: tap a source, then a target. Starts at the source when given. */
export function startConnectMode(sourceId?: Id): void {
  ui().set({ connectMode: { sourceId: sourceId ?? null }, contextMenu: null, panel: null });
  if (sourceId) startConnecting(sourceId);
}

export function cancelConnectMode(): void {
  ui().set({ connectMode: null, connecting: null });
}

/** A tap in connect mode: the first one picks the source, the second connects. */
export function connectModeTap(id: Id, at: Point): void {
  const mode = ui().connectMode;
  if (!mode) return;
  if (!mode.sourceId || mode.sourceId === id) {
    ui().set({ connectMode: { sourceId: id } });
    startConnecting(id);
    return;
  }
  const valid = ui().connecting?.validTargets.has(id) ?? false;
  const sourceId = mode.sourceId;
  cancelConnectMode();
  if (valid) connect(sourceId, id, at);
  else refuseConnection(sourceId, id);
}

export function deleteSelection(): void {
  const { project: p, selection } = project();
  if (!p) return;
  const annotation = ui().selectedAnnotation;
  if (annotation && selection.elements.length + selection.relations.length === 0) {
    removeAnnotation(annotation);
    return;
  }
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

// --- findings ----------------------------------------------------------------------

/** Selects what a finding is about, highlights it and brings it into view. */
export function focusFinding(f: Finding): void {
  const { project: p } = project();
  if (!p) return;
  const relationIds = new Set(p.model.relations.map((r) => r.id));
  project().select({
    elements: f.targetIds.filter((id) => !relationIds.has(id)),
    relations: f.targetIds.filter((id) => relationIds.has(id)),
  });
  ui().set({ activeFinding: findingKey(f) });
  canvasApi.focus?.(focusIds(p, f));
}

/** Applies a quick fix as one undo step. */
export function applyQuickFix(f: Finding, fix: QuickFix): void {
  const { project: p, viewId } = project();
  if (!p) return;
  const near = canvasApi.center?.() ?? { x: 0, y: 0 };
  if (!dispatch(quickFixOps(p, activeView(p, viewId), fix, near), { label: `Fix: ${fix.title}` }))
    return;
  const after = project().project;
  const open = after && findingsOf(after).some((x) => findingKey(x) === findingKey(f));
  ui().toast({
    tone: open ? 'info' : 'success',
    message: open
      ? `${fix.title}: done. ${f.ruleId} still reports a problem here.`
      : `${fix.title}: done. ${f.ruleId} no longer reports it.`,
    actions: [{ label: 'Undo', run: undo }],
  });
}

export function suppressFinding(f: Finding, reason: string): void {
  dispatch(
    [
      {
        op: 'upsertSuppression',
        suppression: {
          ruleId: f.ruleId,
          targetIds: f.targetIds,
          reason: reason.trim(),
          createdAt: new Date().toISOString(),
        },
      },
    ],
    { label: `Suppress ${f.ruleId}` },
  );
}

export function unsuppressFinding(f: Finding): void {
  dispatch([{ op: 'removeSuppression', ruleId: f.ruleId, targetIds: f.targetIds }], {
    label: `Unsuppress ${f.ruleId}`,
  });
}

export function setRulePack(pack: string, on: boolean): void {
  const p = project().project;
  if (!p) return;
  const packs = new Set(p.settings.rulePacks);
  if (on) packs.add(pack);
  else packs.delete(pack);
  dispatch([{ op: 'updateSettings', patch: { rulePacks: [...packs] } }], {
    label: on ? `Turn on ${pack} rules` : `Turn off ${pack} rules`,
  });
}

// --- annotations -------------------------------------------------------------------

const now = () => new Date().toISOString();

function annotationOf(
  id: Id,
): { view: ReturnType<typeof activeView>; annotation: Annotation } | undefined {
  const { project: p, viewId } = project();
  if (!p) return undefined;
  const view = activeView(p, viewId);
  const annotation = view.annotations.find((a) => a.id === id);
  return annotation ? { view, annotation } : undefined;
}

function startEditing(id: Id) {
  project().select({ elements: [], relations: [] });
  ui().set({ selectedAnnotation: id, editingAnnotation: id });
}

export function addSticky(): void {
  const { project: p, viewId } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const center = canvasApi.center?.() ?? { x: 0, y: 0 };
  // Next to the diagram, not on top of a shape.
  const at = freeSpot(
    p,
    view,
    { x: center.x - STICKY_SIZE.w / 2, y: center.y - STICKY_SIZE.h / 2 },
    STICKY_SIZE,
  );
  const { id, ops } = stickyOps(view, at, now());
  if (dispatch(ops, { label: 'Add sticky note' })) startEditing(id);
}

/** A region around the selected shapes, or in the middle of the canvas. */
export function addRegion(): void {
  const { project: p, viewId, selection } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const around = selection.elements
    .filter((id) => view.nodes.some((n) => n.elementId === id))
    .map((id) => ({ ...absolutePosition(p, view, id), ...nodeSize(p, view, id) }));
  const { id, ops } = regionOps(view, canvasApi.center?.() ?? { x: 0, y: 0 }, around, now());
  if (dispatch(ops, { label: 'Add region' })) startEditing(id);
}

/** A callout or comment on the selected element or relation (a comment can also float). */
export function addAnchored(kind: 'callout' | 'comment'): void {
  const { project: p, viewId, selection } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const elementId = selection.elements[0];
  const relationId = selection.relations[0];
  if (!elementId && !relationId && kind === 'callout')
    return void ui().toast({
      tone: 'info',
      message: 'Select a shape or an arrow to add a callout to it.',
    });
  // A comment without a selection floats where the canvas is centered.
  const at = canvasApi.center?.() ?? { x: 0, y: 0 };
  const anchor = elementId
    ? { elementId }
    : relationId
      ? { relationId }
      : { x: snap(at.x), y: snap(at.y) };
  const { id, ops } = anchoredOps(view, kind, anchor, '', now());
  if (dispatch(ops, { label: kind === 'callout' ? 'Add callout' : 'Add comment' })) {
    startEditing(id);
    if (kind === 'comment') ui().set({ openComment: id });
  }
}

export function updateAnnotation(id: Id, patch: Partial<Annotation>, label = 'Edit note'): void {
  const found = annotationOf(id);
  if (!found) return;
  dispatch(
    [
      {
        op: 'upsertAnnotation',
        viewId: found.view.id,
        annotation: { ...found.annotation, ...patch },
      },
    ],
    { label, mergeKey: `annotation:${id}:${label}` },
  );
}

export function removeAnnotation(id: Id): void {
  const found = annotationOf(id);
  if (!found) return;
  if (
    dispatch([{ op: 'removeAnnotation', viewId: found.view.id, id }], {
      label: `Delete ${found.annotation.kind}`,
    })
  )
    ui().set({ selectedAnnotation: null, editingAnnotation: null, openComment: null });
}

export function replyToComment(id: Id, text: string): void {
  const found = annotationOf(id);
  if (!found || !text.trim()) return;
  updateAnnotation(
    id,
    { replies: [...(found.annotation.replies ?? []), { text: text.trim(), createdAt: now() }] },
    'Reply',
  );
}

// --- templates ---------------------------------------------------------------------

/** Adds a template to the open canvas as one undo step, right of the existing diagram. */
export function stampTemplate(template: Template, params: Record<string, unknown>): void {
  const { project: p, viewId } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const origin = stampOrigin(p, view, canvasApi.center?.() ?? { x: 80, y: 80 });
  let result: { ops: Op[]; rootIds: Id[] };
  try {
    result = stampOps(p, view, template, params, origin);
  } catch (error) {
    ui().toast({ tone: 'error', message: (error as Error).message });
    return;
  }
  const newPacks = template.rulePacks.filter((id) => !p.settings.rulePacks.includes(id));
  if (!dispatch(result.ops, { label: `Insert ${template.name}` })) return;
  project().select({ elements: result.rootIds, relations: [] });
  setTimeout(() => canvasApi.focus?.(result.rootIds), 60);
  const packNames = newPacks
    .map((id) => RULE_PACKS.find((x) => x.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  ui().toast({
    tone: 'success',
    message: `Inserted ${template.name}.${packNames ? ` Rule packs turned on: ${packNames}.` : ''}`,
    actions: [{ label: 'Undo', run: undo }],
  });
}

export function exportTemplateFile(file: TemplateFile): void {
  download(`${file.id}.archguide-template.json`, serializeTemplateFile(file), 'application/json');
}

// --- layout ------------------------------------------------------------------------

let elk: InstanceType<typeof ELK> | undefined;

/** ELK runs in its own Web Worker, so a large layout does not freeze the canvas. */
/**
 * Lays out a whole project that is not open (a lesson's start model). Returns the project
 * unchanged when the layout fails.
 */
export async function layoutProject(p: Project): Promise<Project> {
  const view = activeView(p, p.views[0]?.id ?? 'main');
  if (view.nodes.length === 0) return p;
  try {
    const result = applyOps(p, layoutOps(view, await layoutInWorker(toElkGraph(p, view))), catalog);
    return result.ok ? result.project : p;
  } catch {
    return p;
  }
}

function layoutInWorker(graph: ElkNode): Promise<ElkNode> {
  elk ??= new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
  return elk.layout(graph);
}

/** Lays out the whole view automatically (ELK), as one undo step. */
export async function tidyUp(): Promise<void> {
  const { project: p, viewId, version } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  if (view.nodes.length === 0) return;
  let laid: ElkNode;
  try {
    laid = await layoutInWorker(toElkGraph(p, view));
  } catch (error) {
    ui().toast({ tone: 'error', message: `Layout failed: ${(error as Error).message}` });
    return;
  }
  // The diagram changed while the layout ran: its result no longer fits.
  if (project().version !== version) return;
  if (dispatch(layoutOps(view, laid), { label: 'Tidy up' })) {
    setTimeout(() => canvasApi.focus?.(view.nodes.map((n) => n.elementId)), 60);
    ui().toast({ tone: 'success', message: 'Tidied up.', actions: [{ label: 'Undo', run: undo }] });
  }
}

export function alignSelection(how: Alignment): void {
  const { project: p, viewId, selection } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const problem = alignProblem(p, view, selection.elements);
  if (problem) return void ui().toast({ tone: 'info', message: problem });
  dispatch(alignOps(p, view, selection.elements, how), { label: `Align ${how}` });
}

export function distributeSelection(how: Distribution): void {
  const { project: p, viewId, selection } = project();
  if (!p) return;
  const view = activeView(p, viewId);
  const problem = alignProblem(p, view, selection.elements, 3);
  if (problem) return void ui().toast({ tone: 'info', message: problem });
  dispatch(distributeOps(p, view, selection.elements, how), { label: `Distribute ${how}` });
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

/** Adds a database view: the Postgres elements and their readers and writers, colored by owner. */
export function createDatabaseView(): void {
  const p = project().project;
  if (!p) return;
  const { ops, viewId } = databaseViewOps(p, catalog);
  if (dispatch(ops, { label: 'Create database view' })) {
    project().setView(viewId);
    ui().toast({
      tone: 'success',
      message: 'Added the database view. Shapes are colored by the service that owns the data.',
    });
  }
}
