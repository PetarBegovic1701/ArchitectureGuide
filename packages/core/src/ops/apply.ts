import type { ZodType } from 'zod';
import {
  ElementSchema,
  IdSchema,
  OpSchema,
  ProjectMetaSchema,
  ProjectSettingsSchema,
  RelationSchema,
  ViewMetaSchema,
  ViewSchema,
} from '../schema';
import type { Anchor, Element, Id, Op, Project, Relation, View } from '../schema';
import { checkNesting, checkRelation } from '../catalog';
import type { Catalog } from '../catalog';
import { makeRelationId } from '../ids';
import { suppressionKey } from '../serialize';
import { clone } from '../clone';
import { OpFailure } from './errors';
import type { OpError } from './errors';

export type ApplyResult =
  { ok: true; project: Project; inverse: Op[] } | { ok: false; errors: OpError[] };

/**
 * Applies ops in order to a copy of `project` (Implementation.md §8).
 * All or nothing: on the first failing op nothing changes and the error is returned.
 * `inverse` undoes the whole batch when applied to the result.
 */
export function applyOps(project: Project, ops: readonly unknown[], catalog: Catalog): ApplyResult {
  const draft = clone(project);
  const inverses: Op[][] = [];
  for (const [index, raw] of ops.entries()) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errors: [{ index, code: 'SCHEMA_INVALID', message: zodMessage(parsed.error) }],
      };
    }
    try {
      inverses.push(applyOne(draft, parsed.data, catalog));
    } catch (e) {
      if (!(e instanceof OpFailure)) throw e;
      return { ok: false, errors: [{ index, code: e.code, message: e.message, ...e.extra }] };
    }
  }
  return { ok: true, project: draft, inverse: inverses.reverse().flat() };
}

/** Errors the batch would produce, without changing anything. */
export function validateOps(
  project: Project,
  ops: readonly unknown[],
  catalog: Catalog,
): OpError[] {
  const result = applyOps(project, ops, catalog);
  return result.ok ? [] : result.errors;
}

// ---------------------------------------------------------------------------

function applyOne(p: Project, op: Op, catalog: Catalog): Op[] {
  switch (op.op) {
    case 'addElement':
      return addElement(p, op.element, catalog);
    case 'updateElement':
      return updateElement(p, op.id, op.patch, catalog);
    case 'removeElement':
      return removeElement(p, op.id, op.cascade ?? false);
    case 'moveElement':
      return moveElement(p, op.id, op.parentId, catalog);
    case 'addRelation':
      return addRelation(p, op.relation, catalog);
    case 'updateRelation':
      return updateRelation(p, op.id, op.patch, catalog);
    case 'removeRelation':
      return removeRelation(p, op.id);
    case 'renameId':
      return renameId(p, op.from, op.to);
    case 'addView':
      return addView(p, op.view);
    case 'updateView':
      return updateView(p, op.id, op.patch);
    case 'removeView': {
      const view = getView(p, op.id);
      p.views = p.views.filter((v) => v !== view);
      // Restore the view before the tours that point at it.
      return [
        { op: 'addView', view },
        ...detachFromTours(p, new Set(), new Set(), new Set([view.id])),
      ];
    }
    case 'setViewNode': {
      const view = getView(p, op.viewId);
      getElement(p, op.node.elementId);
      return upsertIn(view.nodes, op.node, (n) => n.elementId === op.node.elementId, {
        restore: (prev) => ({ op: 'setViewNode', viewId: view.id, node: prev }),
        remove: () => ({ op: 'removeViewNode', viewId: view.id, elementId: op.node.elementId }),
      });
    }
    case 'removeViewNode': {
      const view = getView(p, op.viewId);
      const prev = removeFrom(
        view.nodes,
        (n) => n.elementId === op.elementId,
        op.elementId,
        'View node',
      );
      return [{ op: 'setViewNode', viewId: view.id, node: prev }];
    }
    case 'setViewEdge': {
      const view = getView(p, op.viewId);
      getRelation(p, op.edge.relationId);
      return upsertIn(view.edges, op.edge, (e) => e.relationId === op.edge.relationId, {
        restore: (prev) => ({ op: 'setViewEdge', viewId: view.id, edge: prev }),
        remove: () => ({ op: 'removeViewEdge', viewId: view.id, relationId: op.edge.relationId }),
      });
    }
    case 'removeViewEdge': {
      const view = getView(p, op.viewId);
      const prev = removeFrom(
        view.edges,
        (e) => e.relationId === op.relationId,
        op.relationId,
        'View edge',
      );
      return [{ op: 'setViewEdge', viewId: view.id, edge: prev }];
    }
    case 'upsertAnnotation': {
      const view = getView(p, op.viewId);
      checkAnchor(p, op.annotation.anchor);
      return upsertIn(view.annotations, op.annotation, (a) => a.id === op.annotation.id, {
        restore: (prev) => ({ op: 'upsertAnnotation', viewId: view.id, annotation: prev }),
        remove: () => ({ op: 'removeAnnotation', viewId: view.id, id: op.annotation.id }),
      });
    }
    case 'removeAnnotation': {
      const view = getView(p, op.viewId);
      const prev = removeFrom(view.annotations, (a) => a.id === op.id, op.id, 'Annotation');
      return [{ op: 'upsertAnnotation', viewId: view.id, annotation: prev }];
    }
    case 'upsertNote':
      return upsertIn(p.notes, op.note, (n) => n.id === op.note.id, {
        restore: (prev) => ({ op: 'upsertNote', note: prev }),
        remove: () => ({ op: 'removeNote', id: op.note.id }),
      });
    case 'removeNote': {
      const prev = removeFrom(p.notes, (n) => n.id === op.id, op.id, 'Note');
      return [{ op: 'upsertNote', note: prev }];
    }
    case 'upsertDecision':
      return upsertIn(p.decisions, op.decision, (d) => d.id === op.decision.id, {
        restore: (prev) => ({ op: 'upsertDecision', decision: prev }),
        remove: () => ({ op: 'removeDecision', id: op.decision.id }),
      });
    case 'removeDecision': {
      const prev = removeFrom(p.decisions, (d) => d.id === op.id, op.id, 'Decision');
      return [{ op: 'upsertDecision', decision: prev }];
    }
    case 'upsertTour': {
      for (const step of op.tour.steps) {
        if (step.viewId) getView(p, step.viewId);
        for (const id of step.elementIds) getElement(p, id);
        for (const id of step.relationIds) getRelation(p, id);
      }
      return upsertIn(p.tours, op.tour, (t) => t.id === op.tour.id, {
        restore: (prev) => ({ op: 'upsertTour', tour: prev }),
        remove: () => ({ op: 'removeTour', id: op.tour.id }),
      });
    }
    case 'removeTour': {
      const prev = removeFrom(p.tours, (t) => t.id === op.id, op.id, 'Tour');
      return [{ op: 'upsertTour', tour: prev }];
    }
    case 'upsertSuppression': {
      const key = suppressionKey(op.suppression);
      return upsertIn(p.settings.suppressions, op.suppression, (s) => suppressionKey(s) === key, {
        restore: (prev) => ({ op: 'upsertSuppression', suppression: prev }),
        remove: () => ({
          op: 'removeSuppression',
          ruleId: op.suppression.ruleId,
          targetIds: op.suppression.targetIds,
        }),
      });
    }
    case 'removeSuppression': {
      const key = suppressionKey(op);
      const prev = removeFrom(
        p.settings.suppressions,
        (s) => suppressionKey(s) === key,
        key,
        'Suppression',
      );
      return [{ op: 'upsertSuppression', suppression: prev }];
    }
    case 'updateProject': {
      const keys = Object.keys(ProjectMetaSchema.shape);
      const { merged, inverse } = mergePatch(p, op.patch, keys, 'Project');
      parseOrFail(ProjectMetaSchema, merged);
      const target = p as Record<string, unknown>;
      for (const k of keys) {
        const value = (merged as Record<string, unknown>)[k];
        if (value === undefined) delete target[k];
        else target[k] = value;
      }
      return [{ op: 'updateProject', patch: inverse }];
    }
    case 'updateSettings': {
      const keys = Object.keys(ProjectSettingsSchema.shape);
      const { merged, inverse } = mergePatch(p.settings, op.patch, keys, 'Settings');
      p.settings = parseOrFail(ProjectSettingsSchema, merged);
      return [{ op: 'updateSettings', patch: inverse }];
    }
    case 'upsertChangeSet':
      return upsertIn(p.changeSets, op.changeSet, (c) => c.id === op.changeSet.id, {
        restore: (prev) => ({ op: 'upsertChangeSet', changeSet: prev }),
        remove: () => ({ op: 'removeChangeSet', id: op.changeSet.id }),
      });
    case 'removeChangeSet': {
      const prev = removeFrom(p.changeSets, (c) => c.id === op.id, op.id, 'Change set');
      return [{ op: 'upsertChangeSet', changeSet: prev }];
    }
  }
}

// --- elements ----------------------------------------------------------------

function addElement(p: Project, element: Element, catalog: Catalog): Op[] {
  assertIdFree(p, element.id);
  const concept = catalog.concepts.get(element.kind);
  if (!concept)
    throw new OpFailure('UNKNOWN_KIND', `Unknown concept "${element.kind}".`, {
      itemId: element.id,
    });
  assertNesting(p, catalog, element, element.parentId ?? null);
  assertProperties(catalog, element);
  p.model.elements.push(element);
  return [{ op: 'removeElement', id: element.id }];
}

function updateElement(p: Project, id: Id, patch: Record<string, unknown>, catalog: Catalog): Op[] {
  const el = getElement(p, id);
  if ('id' in patch)
    throw new OpFailure('SCHEMA_INVALID', 'Use renameId to change an ID.', { itemId: id });
  if ('parentId' in patch) {
    throw new OpFailure('SCHEMA_INVALID', 'Use moveElement to change the parent.', { itemId: id });
  }
  const { merged, inverse } = mergePatch(el, patch, undefined, 'Element');
  const next = parseOrFail(ElementSchema, merged, id);
  if (next.kind !== el.kind) {
    if (!catalog.concepts.has(next.kind)) {
      throw new OpFailure('UNKNOWN_KIND', `Unknown concept "${next.kind}".`, { itemId: id });
    }
    assertNesting(p, catalog, next, next.parentId ?? null);
    for (const child of p.model.elements.filter((e) => e.parentId === id)) {
      const check = checkNesting(catalog, child.kind, next.kind);
      if (!check.ok)
        throw new OpFailure('NESTING_NOT_ALLOWED', check.message, { itemId: child.id });
    }
    const kinds = new Map(p.model.elements.map((e) => [e.id, e.id === id ? next.kind : e.kind]));
    for (const r of p.model.relations.filter((r) => r.sourceId === id || r.targetId === id)) {
      assertRelationAllowed(catalog, r, kinds.get(r.sourceId)!, kinds.get(r.targetId)!);
    }
  }
  assertProperties(catalog, next);
  replaceIn(p.model.elements, el, next);
  return [{ op: 'updateElement', id, patch: inverse }];
}

function removeElement(p: Project, id: Id, cascade: boolean): Op[] {
  const root = getElement(p, id);
  // Breadth-first, so parents always come before their children (needed for the inverse).
  const removed: Element[] = [root];
  for (let i = 0; i < removed.length; i++) {
    removed.push(...p.model.elements.filter((e) => e.parentId === removed[i]!.id));
  }
  const removedIds = new Set(removed.map((e) => e.id));
  const relations = p.model.relations.filter(
    (r) => removedIds.has(r.sourceId) || removedIds.has(r.targetId),
  );
  if (!cascade && (removed.length > 1 || relations.length > 0)) {
    throw new OpFailure(
      'HAS_DEPENDENTS',
      `${root.name} has ${removed.length - 1} child element(s) and ${relations.length} relation(s).`,
      { itemId: id, hint: 'Remove them first, or set cascade: true.' },
    );
  }
  const relationIds = new Set(relations.map((r) => r.id));
  p.model.elements = p.model.elements.filter((e) => !removedIds.has(e.id));
  p.model.relations = p.model.relations.filter((r) => !relationIds.has(r.id));
  return [
    ...removed.map((element): Op => ({ op: 'addElement', element })),
    ...relations.map((relation): Op => ({ op: 'addRelation', relation })),
    ...detachFromViews(p, removedIds, relationIds),
    ...detachFromTours(p, removedIds, relationIds, new Set()),
  ];
}

function moveElement(p: Project, id: Id, parentId: Id | null, catalog: Catalog): Op[] {
  const el = getElement(p, id);
  const previous = el.parentId ?? null;
  if (parentId !== null) {
    getElement(p, parentId);
    for (let cur: Id | undefined = parentId; cur; cur = findElement(p, cur)?.parentId) {
      if (cur === id)
        throw new OpFailure('NESTING_CYCLE', 'An element cannot be inside itself.', { itemId: id });
    }
  }
  assertNesting(p, catalog, el, parentId);
  const next = { ...el };
  if (parentId === null) delete next.parentId;
  else next.parentId = parentId;
  replaceIn(p.model.elements, el, next);
  return [{ op: 'moveElement', id, parentId: previous }];
}

// --- relations ---------------------------------------------------------------

function addRelation(p: Project, relation: Relation, catalog: Catalog): Op[] {
  assertIdFree(p, relation.id);
  const source = getElement(p, relation.sourceId);
  const target = getElement(p, relation.targetId);
  assertRelationAllowed(catalog, relation, source.kind, target.kind, p);
  assertRelationProperties(catalog, relation);
  p.model.relations.push(relation);
  return [{ op: 'removeRelation', id: relation.id }];
}

function updateRelation(
  p: Project,
  id: Id,
  patch: Record<string, unknown>,
  catalog: Catalog,
): Op[] {
  const rel = getRelation(p, id);
  if ('id' in patch)
    throw new OpFailure('SCHEMA_INVALID', 'Use renameId to change an ID.', { itemId: id });
  const { merged, inverse } = mergePatch(rel, patch, undefined, 'Relation');
  const next = parseOrFail(RelationSchema, merged, id);
  if (next.type !== rel.type || next.sourceId !== rel.sourceId || next.targetId !== rel.targetId) {
    const source = getElement(p, next.sourceId);
    const target = getElement(p, next.targetId);
    assertRelationAllowed(catalog, next, source.kind, target.kind);
  }
  assertRelationProperties(catalog, next);
  replaceIn(p.model.relations, rel, next);
  return [{ op: 'updateRelation', id, patch: inverse }];
}

function removeRelation(p: Project, id: Id): Op[] {
  const rel = getRelation(p, id);
  p.model.relations = p.model.relations.filter((r) => r !== rel);
  const ids = new Set([id]);
  return [
    { op: 'addRelation', relation: rel },
    ...detachFromViews(p, new Set(), ids),
    ...detachFromTours(p, new Set(), ids, new Set()),
  ];
}

// --- ids ---------------------------------------------------------------------

/**
 * Renames an element or relation ID and updates every reference: parents, relation ends,
 * view nodes/edges/scopes/scenarios, annotation anchors, note and decision links,
 * suppressions, and element properties whose value is exactly the old ID (e.g. `ownedBy`).
 * Ops stored inside change sets are not rewritten.
 */
function renameId(p: Project, from: Id, to: Id): Op[] {
  const el = findElement(p, from);
  const rel = el ? undefined : p.model.relations.find((r) => r.id === from);
  if (!el && !rel)
    throw new OpFailure('ID_NOT_FOUND', `No element or relation "${from}".`, { itemId: from });
  if (!IdSchema.safeParse(to).success) {
    throw new OpFailure('SCHEMA_INVALID', `"${to}" is not a valid ID.`, { itemId: from });
  }
  assertIdFree(p, to);
  const swap = (id: Id) => (id === from ? to : id);
  const swapAll = (ids: Id[]) => ids.map(swap);

  for (const e of p.model.elements) {
    e.id = swap(e.id);
    if (e.parentId) e.parentId = swap(e.parentId);
    if (e.properties) {
      for (const [k, v] of Object.entries(e.properties)) if (v === from) e.properties[k] = to;
    }
  }
  for (const r of p.model.relations) {
    r.id = swap(r.id);
    r.sourceId = swap(r.sourceId);
    r.targetId = swap(r.targetId);
  }
  for (const v of p.views) {
    if (v.scopeElementId) v.scopeElementId = swap(v.scopeElementId);
    for (const n of v.nodes) n.elementId = swap(n.elementId);
    for (const e of v.edges) e.relationId = swap(e.relationId);
    for (const a of v.annotations) {
      if ('elementId' in a.anchor) a.anchor = { elementId: swap(a.anchor.elementId) };
      else if ('relationId' in a.anchor) a.anchor = { relationId: swap(a.anchor.relationId) };
    }
    for (const s of v.scenario?.steps ?? []) s.relationId = swap(s.relationId);
  }
  for (const n of p.notes) n.linkedIds = swapAll(n.linkedIds);
  for (const d of p.decisions) d.linkedIds = swapAll(d.linkedIds);
  for (const s of p.settings.suppressions) s.targetIds = swapAll(s.targetIds);
  for (const step of p.tours.flatMap((t) => t.steps)) {
    step.elementIds = swapAll(step.elementIds);
    step.relationIds = swapAll(step.relationIds);
  }
  return [{ op: 'renameId', from: to, to: from }];
}

// --- views -------------------------------------------------------------------

function addView(p: Project, view: View): Op[] {
  if (p.views.some((v) => v.id === view.id)) {
    throw new OpFailure('ID_EXISTS', `A view "${view.id}" already exists.`, { itemId: view.id });
  }
  if (view.scopeElementId) getElement(p, view.scopeElementId);
  for (const n of view.nodes) getElement(p, n.elementId);
  for (const e of view.edges) getRelation(p, e.relationId);
  for (const a of view.annotations) checkAnchor(p, a.anchor);
  p.views.push(view);
  return [{ op: 'removeView', id: view.id }];
}

function updateView(p: Project, id: Id, patch: Record<string, unknown>): Op[] {
  const view = getView(p, id);
  const keys = Object.keys(ViewMetaSchema.shape);
  const { merged, inverse } = mergePatch(view, patch, keys, 'View');
  const next = parseOrFail(ViewSchema, merged, id);
  if (next.scopeElementId) getElement(p, next.scopeElementId);
  for (const s of next.scenario?.steps ?? []) getRelation(p, s.relationId);
  replaceIn(p.views, view, next);
  return [{ op: 'updateView', id, patch: inverse }];
}

/** Removes view nodes, edges, anchored annotations, scopes and scenario steps; returns their inverse. */
function detachFromViews(p: Project, elementIds: Set<Id>, relationIds: Set<Id>): Op[] {
  const inverse: Op[] = [];
  const anchoredToRemoved = (a: Anchor) =>
    ('elementId' in a && elementIds.has(a.elementId)) ||
    ('relationId' in a && relationIds.has(a.relationId));
  for (const view of p.views) {
    for (const node of view.nodes.filter((n) => elementIds.has(n.elementId))) {
      inverse.push({ op: 'setViewNode', viewId: view.id, node });
    }
    for (const edge of view.edges.filter((e) => relationIds.has(e.relationId))) {
      inverse.push({ op: 'setViewEdge', viewId: view.id, edge });
    }
    for (const annotation of view.annotations.filter((a) => anchoredToRemoved(a.anchor))) {
      inverse.push({ op: 'upsertAnnotation', viewId: view.id, annotation });
    }
    view.nodes = view.nodes.filter((n) => !elementIds.has(n.elementId));
    view.edges = view.edges.filter((e) => !relationIds.has(e.relationId));
    view.annotations = view.annotations.filter((a) => !anchoredToRemoved(a.anchor));

    const restore: Record<string, unknown> = {};
    if (view.scopeElementId && elementIds.has(view.scopeElementId)) {
      restore.scopeElementId = view.scopeElementId;
      delete view.scopeElementId;
    }
    if (view.scenario?.steps.some((s) => relationIds.has(s.relationId))) {
      restore.scenario = clone(view.scenario);
      view.scenario = { steps: view.scenario.steps.filter((s) => !relationIds.has(s.relationId)) };
    }
    if (Object.keys(restore).length > 0)
      inverse.push({ op: 'updateView', id: view.id, patch: restore });
  }
  return inverse;
}

/**
 * Removes deleted elements, relations and views from tour steps; returns their inverse.
 * A tour keeps its steps even when a step has nothing left to highlight.
 */
function detachFromTours(
  p: Project,
  elementIds: Set<Id>,
  relationIds: Set<Id>,
  viewIds: Set<Id>,
): Op[] {
  const inverse: Op[] = [];
  p.tours = p.tours.map((tour) => {
    const touched = tour.steps.some(
      (s) =>
        (s.viewId !== undefined && viewIds.has(s.viewId)) ||
        s.elementIds.some((id) => elementIds.has(id)) ||
        s.relationIds.some((id) => relationIds.has(id)),
    );
    if (!touched) return tour;
    inverse.push({ op: 'upsertTour', tour });
    return {
      ...tour,
      steps: tour.steps.map((s) => {
        const step = {
          ...s,
          elementIds: s.elementIds.filter((id) => !elementIds.has(id)),
          relationIds: s.relationIds.filter((id) => !relationIds.has(id)),
        };
        if (step.viewId !== undefined && viewIds.has(step.viewId)) delete step.viewId;
        return step;
      }),
    };
  });
  return inverse;
}

function checkAnchor(p: Project, anchor: Anchor): void {
  if ('elementId' in anchor) getElement(p, anchor.elementId);
  else if ('relationId' in anchor) getRelation(p, anchor.relationId);
}

// --- checks --------------------------------------------------------------------

function assertIdFree(p: Project, id: Id): void {
  if (findElement(p, id) || p.model.relations.some((r) => r.id === id)) {
    throw new OpFailure('ID_EXISTS', `The ID "${id}" is already used.`, { itemId: id });
  }
}

function assertNesting(p: Project, catalog: Catalog, el: Element, parentId: Id | null): void {
  const parentKind = parentId === null ? null : getElement(p, parentId).kind;
  const check = checkNesting(catalog, el.kind, parentKind);
  if (!check.ok) throw new OpFailure(check.code, check.message, { itemId: el.id });
}

function assertRelationAllowed(
  catalog: Catalog,
  r: Relation,
  sourceKind: string,
  targetKind: string,
  p?: Project,
): void {
  const check = checkRelation(catalog, r.type, sourceKind, targetKind, {
    self: r.sourceId === r.targetId,
  });
  if (check.ok) return;
  const extra: { itemId: Id; hint?: string; fix?: Op[] } = { itemId: r.id };
  if (check.flip && p) {
    const taken = new Set([
      ...p.model.elements.map((e) => e.id),
      ...p.model.relations.map((x) => x.id),
    ]);
    const flipped: Relation = {
      ...r,
      id: makeRelationId(r.targetId, check.flip, r.sourceId, taken),
      type: check.flip,
      sourceId: r.targetId,
      targetId: r.sourceId,
    };
    extra.hint = `Reverse it: ${r.targetId} ${check.flip} ${r.sourceId}.`;
    extra.fix = [{ op: 'addRelation', relation: flipped }];
  }
  throw new OpFailure(check.code, check.message, extra);
}

function assertRelationProperties(catalog: Catalog, r: Relation): void {
  const schema = catalog.relationTypes.get(r.type)?.propertySchema;
  if (!schema || !r.properties) return;
  const result = schema.safeParse(r.properties);
  if (!result.success) {
    throw new OpFailure(
      'PROPERTY_INVALID',
      `Invalid properties for ${r.type}: ${zodMessage(result.error)}`,
      {
        itemId: r.id,
      },
    );
  }
}

function assertProperties(catalog: Catalog, el: Element): void {
  const schema = catalog.concepts.get(el.kind)?.propertySchema;
  if (!schema || !el.properties) return;
  const result = schema.safeParse(el.properties);
  if (!result.success) {
    throw new OpFailure(
      'PROPERTY_INVALID',
      `Invalid properties for ${el.kind}: ${zodMessage(result.error)}`,
      {
        itemId: el.id,
      },
    );
  }
}

// --- helpers -------------------------------------------------------------------

function findElement(p: Project, id: Id): Element | undefined {
  return p.model.elements.find((e) => e.id === id);
}

function getElement(p: Project, id: Id): Element {
  const el = findElement(p, id);
  if (!el) throw new OpFailure('ID_NOT_FOUND', `No element "${id}".`, { itemId: id });
  return el;
}

function getRelation(p: Project, id: Id): Relation {
  const rel = p.model.relations.find((r) => r.id === id);
  if (!rel) throw new OpFailure('ID_NOT_FOUND', `No relation "${id}".`, { itemId: id });
  return rel;
}

function getView(p: Project, id: Id): View {
  const view = p.views.find((v) => v.id === id);
  if (!view) throw new OpFailure('ID_NOT_FOUND', `No view "${id}".`, { itemId: id });
  return view;
}

function replaceIn<T>(list: T[], prev: T, next: T): void {
  list[list.indexOf(prev)] = next;
}

/** Inserts or replaces the item matching `match`; returns the op that undoes it. */
function upsertIn<T>(
  list: T[],
  item: T,
  match: (x: T) => boolean,
  inverse: { restore: (prev: T) => Op; remove: () => Op },
): Op[] {
  const index = list.findIndex(match);
  if (index === -1) {
    list.push(item);
    return [inverse.remove()];
  }
  const prev = list[index]!;
  list[index] = item;
  return [inverse.restore(prev)];
}

function removeFrom<T>(list: T[], match: (x: T) => boolean, id: string, what: string): T {
  const index = list.findIndex(match);
  if (index === -1)
    throw new OpFailure('ID_NOT_FOUND', `${what} "${id}" not found.`, { itemId: id });
  return list.splice(index, 1)[0]!;
}

/**
 * Shallow merge; `null` removes a field. `allowed` limits the keys a patch may touch.
 * Returns the merged copy and the patch that restores the previous values.
 */
function mergePatch<T extends object>(
  target: T,
  patch: Record<string, unknown>,
  allowed: string[] | undefined,
  what: string,
): { merged: T; inverse: Record<string, unknown> } {
  const merged = { ...target } as Record<string, unknown>;
  const inverse: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allowed && !allowed.includes(key)) {
      throw new OpFailure(
        'SCHEMA_INVALID',
        `${what} field "${key}" cannot be changed with this op.`,
      );
    }
    const prev = merged[key];
    inverse[key] = prev === undefined ? null : clone(prev);
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return { merged: merged as T, inverse };
}

function parseOrFail<T>(schema: ZodType<T>, value: unknown, itemId?: Id): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OpFailure('SCHEMA_INVALID', zodMessage(result.error), itemId ? { itemId } : {});
  }
  return result.data;
}

function zodMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}
