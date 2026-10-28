import { checkRelation, validRelationTypes } from '../catalog';
import type { Catalog } from '../catalog';
import { makeElementId, makeRelationId } from '../ids';
import type { OpError } from '../ops';
import { IdSchema } from '../schema';
import type { Element, Id, ModelOp, Project, Relation } from '../schema';

/**
 * Turns the inputs of agent and CLI tools into ops (Implementation.md §20.2). The caller
 * applies the ops with `applyOps`, which does the full validation.
 */

/** An element to create (no `id`, or an unknown one) or to update (a known `id`). */
export type ElementInput = Partial<Omit<Element, 'parentId'>> & {
  kind: string;
  name: string;
  /** null moves an existing element to the top level. */
  parentId?: Id | null;
};

export type RelationInput = Partial<Relation> & { sourceId: Id; targetId: Id };

export interface EditResult {
  ops: ModelOp[];
  /** IDs of the created or updated items, in input order. */
  ids: Id[];
  errors: OpError[];
}

const taken = (p: Project) =>
  new Set<Id>([...p.model.elements.map((e) => e.id), ...p.model.relations.map((r) => r.id)]);

/** Concepts whose name, ID or aliases contain the words of `text`, for "did you mean". */
export function suggestKinds(catalog: Catalog, text: string, limit = 5): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const scored = [...catalog.concepts.values()]
    .map((c) => {
      const hay = [c.id, c.name, ...(c.aliases ?? [])].join(' ').toLowerCase();
      return { id: c.id, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((c) => c.id);
}

export function upsertElementsOps(
  project: Project,
  catalog: Catalog,
  inputs: readonly ElementInput[],
): EditResult {
  const ops: ModelOp[] = [];
  const ids: Id[] = [];
  const errors: OpError[] = [];
  const used = taken(project);
  const existing = new Map(project.model.elements.map((e) => [e.id, e]));

  inputs.forEach((input, index) => {
    const { id, parentId, kind, ...fields } = input;
    const current = id ? existing.get(id) : undefined;
    if (current) {
      if (kind !== current.kind) {
        errors.push({
          index,
          code: 'SCHEMA_INVALID',
          itemId: current.id,
          message: `${current.id} is a ${current.kind}; the kind of an element cannot change.`,
          hint: 'Remove it and add a new element, or keep the kind.',
        });
        return;
      }
      const patch = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Record<string, unknown>;
      if (Object.keys(patch).length > 0) ops.push({ op: 'updateElement', id: current.id, patch });
      if (parentId !== undefined && parentId !== (current.parentId ?? null))
        ops.push({ op: 'moveElement', id: current.id, parentId });
      ids.push(current.id);
      return;
    }
    const concept = catalog.concepts.get(kind);
    if (!concept) {
      const like = suggestKinds(catalog, `${kind} ${input.name}`);
      errors.push({
        index,
        code: 'UNKNOWN_KIND',
        message: `Unknown concept "${kind}".`,
        hint: like.length
          ? `Did you mean ${like.map((k) => `"${k}"`).join(', ')}? get_catalog lists all concepts.`
          : 'get_catalog lists all concepts.',
      });
      return;
    }
    if (id !== undefined && !IdSchema.safeParse(id).success) {
      errors.push({
        index,
        code: 'SCHEMA_INVALID',
        message: `"${id}" is not a valid ID.`,
        hint: 'IDs use lowercase letters, digits, "." and "-", like "svc.orders". Leave it out to get one.',
      });
      return;
    }
    const newId = id ?? makeElementId(concept.idPrefix, input.name, used);
    used.add(newId);
    const element: Element = {
      status: 'planned',
      ...(fields as Partial<Element>),
      id: newId,
      kind,
      name: input.name,
      ...(parentId ? { parentId } : {}),
    } as Element;
    ops.push({ op: 'addElement', element });
    existing.set(newId, element);
    ids.push(newId);
  });
  return { ops, ids, errors };
}

export function upsertRelationsOps(
  project: Project,
  catalog: Catalog,
  inputs: readonly RelationInput[],
): EditResult {
  const ops: ModelOp[] = [];
  const ids: Id[] = [];
  const errors: OpError[] = [];
  const used = taken(project);
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  const existing = new Map(project.model.relations.map((r) => [r.id, r]));

  inputs.forEach((input, index) => {
    const { id, ...fields } = input;
    const current = id ? existing.get(id) : undefined;
    if (current) {
      const patch = Object.fromEntries(
        Object.entries(fields).filter(
          ([k, v]) => v !== undefined && k !== 'sourceId' && k !== 'targetId',
        ),
      ) as Record<string, unknown>;
      if (input.sourceId !== current.sourceId || input.targetId !== current.targetId) {
        errors.push({
          index,
          code: 'SCHEMA_INVALID',
          itemId: current.id,
          message: `${current.id} connects ${current.sourceId} → ${current.targetId}; its ends cannot change.`,
          hint: 'Remove it and add a new relation.',
        });
        return;
      }
      if (Object.keys(patch).length > 0) ops.push({ op: 'updateRelation', id: current.id, patch });
      ids.push(current.id);
      return;
    }
    const source = elements.get(input.sourceId);
    const target = elements.get(input.targetId);
    const missing = [!source && input.sourceId, !target && input.targetId].filter(Boolean);
    if (missing.length) {
      errors.push({
        index,
        code: 'ID_NOT_FOUND',
        itemId: String(missing[0]),
        message: `Unknown element ${missing.map((m) => `"${m}"`).join(' and ')}.`,
        hint: 'Create elements first (upsert_elements), then connect them.',
      });
      return;
    }
    let type = input.type;
    if (!type) {
      const valid = validRelationTypes(catalog, source!.kind, target!.kind);
      if (valid.length === 1) type = valid[0]!.id;
      else {
        errors.push({
          index,
          code: valid.length === 0 ? 'RELATION_NOT_ALLOWED' : 'SCHEMA_INVALID',
          message:
            valid.length === 0
              ? `Nothing can connect ${source!.kind} → ${target!.kind}.`
              : `Several relation types fit ${source!.kind} → ${target!.kind}: ${valid.map((t) => t.id).join(', ')}. Say which one.`,
          hint:
            valid.length === 0
              ? (
                  checkRelation(catalog, 'calls', source!.kind, target!.kind) as {
                    message?: string;
                  }
                ).message
              : `Set "type" to one of: ${valid.map((t) => t.id).join(', ')}.`,
        });
        return;
      }
    }
    const newId = id ?? makeRelationId(input.sourceId, type, input.targetId, used);
    used.add(newId);
    const relation: Relation = { status: 'planned', ...fields, id: newId, type } as Relation;
    ops.push({ op: 'addRelation', relation });
    ids.push(newId);
  });
  return { ops, ids, errors };
}

/** Ops that remove elements (with their children and relations when `cascade`) and relations. */
export function removeItemsOps(project: Project, ids: readonly Id[], cascade = true): EditResult {
  const errors: OpError[] = [];
  const elements = new Set(project.model.elements.map((e) => e.id));
  const relations = new Set(project.model.relations.map((r) => r.id));
  const parentOf = new Map(project.model.elements.map((e) => [e.id, e.parentId]));
  const chosen = new Set(ids);
  // Children of a removed element go with it; do not remove them twice.
  const underChosen = (id: Id) => {
    for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (chosen.has(p)) return true;
    return false;
  };
  const ops: ModelOp[] = [];
  ids.forEach((id, index) => {
    if (relations.has(id)) ops.unshift({ op: 'removeRelation', id });
    else if (elements.has(id)) {
      if (!(cascade && underChosen(id))) ops.push({ op: 'removeElement', id, cascade });
    } else
      errors.push({ index, code: 'ID_NOT_FOUND', itemId: id, message: `Unknown item "${id}".` });
  });
  return { ops, ids: [...ids], errors };
}
