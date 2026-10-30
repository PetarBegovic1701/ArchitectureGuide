import { checkNesting, checkRelation } from '../catalog';
import type { Catalog } from '../catalog';
import type { AntiPattern, Id, ModelOp, Project } from '../schema';

/** The note of an item marked in "as found" mode when the caller gave none. */
export const AS_FOUND_NOTE = 'Found in the analyzed code';

export interface AsFoundResult {
  ops: ModelOp[];
  /** Items that got an anti-pattern mark, in op order. */
  marked: Id[];
}

/**
 * Prepares ops that record existing code (Implementation.md §20.2, `asFound`): an element
 * placed where the nesting rules refuse it, or a relation the relation rules refuse, gets an
 * anti-pattern mark with the rule it breaks, so it is kept and reported (AP-019) instead of
 * refused. Items that already carry a mark get the broken rule filled in. Without
 * `asFound`, only marked items are touched. Unknown kinds, types and IDs still fail in
 * `applyOps`.
 */
export function markAsFound(
  project: Project,
  catalog: Catalog,
  ops: readonly ModelOp[],
  options: { asFound?: boolean; note?: string } = {},
): AsFoundResult {
  const kinds = new Map(project.model.elements.map((e) => [e.id, e.kind]));
  const marks = new Map(project.model.elements.map((e) => [e.id, e.antiPattern]));
  const marked: Id[] = [];
  const mark = (current: AntiPattern | undefined, violates: string): AntiPattern | undefined => {
    if (current) return current.violates ? current : { ...current, violates };
    if (!options.asFound) return undefined;
    return { note: options.note ?? AS_FOUND_NOTE, violates };
  };
  const out: ModelOp[] = [];
  for (const op of ops) {
    if (op.op === 'addElement') {
      const el = op.element;
      kinds.set(el.id, el.kind);
      const parentKind = el.parentId ? kinds.get(el.parentId) : null;
      const check =
        parentKind === undefined
          ? { ok: true as const }
          : checkNesting(catalog, el.kind, parentKind);
      const antiPattern =
        !check.ok && check.code === 'NESTING_NOT_ALLOWED'
          ? mark(el.antiPattern, check.message)
          : undefined;
      marks.set(el.id, antiPattern ?? el.antiPattern);
      if (antiPattern && antiPattern !== el.antiPattern) {
        if (!el.antiPattern) marked.push(el.id);
        out.push({ ...op, element: { ...el, antiPattern } });
        continue;
      }
    } else if (op.op === 'moveElement') {
      const kind = kinds.get(op.id);
      const parentKind = op.parentId === null ? null : kinds.get(op.parentId);
      if (kind && parentKind !== undefined) {
        const check = checkNesting(catalog, kind, parentKind);
        if (!check.ok && check.code === 'NESTING_NOT_ALLOWED') {
          const antiPattern = mark(marks.get(op.id), check.message);
          if (antiPattern && antiPattern !== marks.get(op.id)) {
            if (!marks.get(op.id)) marked.push(op.id);
            marks.set(op.id, antiPattern);
            out.push({ op: 'updateElement', id: op.id, patch: { antiPattern } });
          }
        }
      }
    } else if (op.op === 'addRelation') {
      const r = op.relation;
      const source = kinds.get(r.sourceId);
      const target = kinds.get(r.targetId);
      if (source && target) {
        const check = checkRelation(catalog, r.type, source, target, {
          self: r.sourceId === r.targetId,
        });
        if (
          !check.ok &&
          (check.code === 'RELATION_NOT_ALLOWED' || check.code === 'SELF_RELATION')
        ) {
          const antiPattern = mark(r.antiPattern, check.message);
          if (antiPattern && antiPattern !== r.antiPattern) {
            if (!r.antiPattern) marked.push(r.id);
            out.push({ ...op, relation: { ...r, antiPattern } });
            continue;
          }
        }
      }
    }
    out.push(op);
  }
  return { ops: out, marked };
}
