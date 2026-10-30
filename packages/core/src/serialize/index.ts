import { ProjectSchema } from '../schema';
import type { Element, Project, Relation } from '../schema';
import { migrate } from '../migrate';

/**
 * Deterministic project serialization (Implementation.md §7.4):
 * schema key order, items sorted by ID, empty optional fields left out,
 * 2-space indentation and a final newline. Equal projects give equal bytes.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(canonicalize(project), null, 2)}\n`;
}

/** Parses JSON text or a plain object, migrates old schema versions, and validates. */
export function parseProject(input: string | unknown): Project {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  return ProjectSchema.parse(migrate(raw));
}

/** Returns a validated copy in canonical form (key order, sorting, pruning). */
export function canonicalize(project: Project): Project {
  const p = ProjectSchema.parse(project);
  const byId = <T extends { id: string }>(a: T, b: T) => compare(a.id, b.id);

  p.model.elements = p.model.elements.map(pruneElement).sort(byId);
  p.model.relations = p.model.relations.map(pruneRelation).sort(byId);
  p.views.sort(byId);
  for (const view of p.views) {
    view.nodes.sort((a, b) => compare(a.elementId, b.elementId));
    view.edges.sort((a, b) => compare(a.relationId, b.relationId));
    view.annotations.sort(byId);
    for (const edge of view.edges) dropEmpty(edge, ['waypoints']);
    for (const a of view.annotations) dropEmpty(a, ['replies']);
  }
  p.notes.sort(byId);
  p.decisions.sort(byId);
  p.tours.sort(byId);
  p.changeSets.sort(byId);
  p.snapshots.sort(byId);
  for (const cs of p.changeSets) dropEmpty(cs, ['tasks']);
  dropEmpty(p, ['derivedFrom']);
  if (p.docs) dropEmpty(p.docs, ['sources']);
  for (const s of p.settings.suppressions) s.targetIds.sort(compare);
  p.settings.suppressions.sort((a, b) => compare(suppressionKey(a), suppressionKey(b)));
  p.settings.ruleOverrides = sortKeys(p.settings.ruleOverrides);
  if (p.settings.palette) p.settings.palette = sortKeys(p.settings.palette);
  dropEmpty(p.settings, ['palette']);
  return p;
}

export function suppressionKey(s: { ruleId: string; targetIds: readonly string[] }): string {
  return `${s.ruleId}|${[...s.targetIds].sort(compare).join(',')}`;
}

function pruneElement(e: Element): Element {
  dropEmpty(e, ['responsibilities', 'tags', 'codePaths', 'properties', 'qualities']);
  if (e.properties) e.properties = sortKeys(e.properties);
  if (e.source) dropEmpty(e.source, ['evidence']);
  if (e.docs) dropEmpty(e.docs, ['sources']);
  dropEmpty(e, ['docs']);
  return e;
}

function pruneRelation(r: Relation): Relation {
  dropEmpty(r, ['properties']);
  if (r.properties) r.properties = sortKeys(r.properties);
  if (r.source) dropEmpty(r.source, ['evidence']);
  return r;
}

/** Removes the listed keys when they hold an empty array or an empty object. */
function dropEmpty<T extends object>(obj: T, keys: (keyof T)[]): void {
  for (const key of keys) {
    const v = obj[key];
    const empty =
      (Array.isArray(v) && v.length === 0) ||
      (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
    if (empty) delete obj[key];
  }
}

function sortKeys<V>(record: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
}

/** Locale-independent string order, so output is the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
