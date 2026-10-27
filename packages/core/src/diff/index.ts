import type { Element, Id, Project, Relation } from '../schema';

export interface ProjectDiff {
  added: { elements: Id[]; relations: Id[] };
  removed: { elements: Id[]; relations: Id[] };
  /** Items in both projects whose fields differ, with the names of those fields. */
  changed: { id: Id; kind: 'element' | 'relation'; fields: string[] }[];
}

/** Order-independent JSON of a value, so `{a, b}` and `{b, a}` compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function changedFields<T extends Element | Relation>(a: T, b: T): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter(
      (k) =>
        stable((a as Record<string, unknown>)[k]) !== stable((b as Record<string, unknown>)[k]),
    )
    .sort();
}

function diffList<T extends Element | Relation>(before: readonly T[], after: readonly T[]) {
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Map(after.map((x) => [x.id, x]));
  const added = after.filter((x) => !old.has(x.id)).map((x) => x.id);
  const removed = before.filter((x) => !now.has(x.id)).map((x) => x.id);
  const changed = after
    .filter((x) => old.has(x.id))
    .map((x) => ({ id: x.id, fields: changedFields(old.get(x.id)!, x) }))
    .filter((c) => c.fields.length > 0);
  return { added: added.sort(), removed: removed.sort(), changed };
}

/**
 * What changed in the model from `before` to `after` (Implementation.md §16.3). Used to
 * compare snapshots, and later for change sets and analyzer drift. Layout is not compared.
 */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const elements = diffList(before.model.elements, after.model.elements);
  const relations = diffList(before.model.relations, after.model.relations);
  return {
    added: { elements: elements.added, relations: relations.added },
    removed: { elements: elements.removed, relations: relations.removed },
    changed: [
      ...elements.changed.map((c) => ({ ...c, kind: 'element' as const })),
      ...relations.changed.map((c) => ({ ...c, kind: 'relation' as const })),
    ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** True when the two projects have the same model. */
export function isEmptyDiff(d: ProjectDiff): boolean {
  return (
    d.added.elements.length +
      d.added.relations.length +
      d.removed.elements.length +
      d.removed.relations.length +
      d.changed.length ===
    0
  );
}
