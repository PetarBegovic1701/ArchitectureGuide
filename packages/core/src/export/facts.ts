import { GraphQuery } from '../graph';
import type { Catalog } from '../catalog';
import type { LearningDoc } from '../learn/schema';
import { activeRules, allRules, runRules } from '../rules';
import type { Finding } from '../rules';
import { LayerSchema } from '../schema';
import type { Element, Id, Project, Relation } from '../schema';
import type { ExportOptions } from './types';

/**
 * What every exporter needs, computed once: the elements and relations to show (in a
 * stable order), the rule findings, and the derived sections (Implementation.md §18.1).
 */
export interface Facts {
  project: Project;
  catalog: Catalog;
  graph: GraphQuery;
  /** Elements in the export, by layer and then ID. */
  elements: Element[];
  /** Relations between exported elements, by source, type, target. */
  relations: Relation[];
  included: ReadonlySet<Id>;
  findings: Finding[];
}

const LAYER_ORDER = LayerSchema.options;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The focus element, everything inside it, its ancestors, and what is reachable from it
 * over up to `depth` relations in either direction (with their containers).
 */
export function neighborhood(project: Project, catalog: Catalog, focus: Id, depth = 1): Set<Id> {
  const graph = new GraphQuery(project, catalog);
  const result = new Set<Id>();
  if (!graph.element(focus)) return result;
  let frontier = new Set<Id>(graph.subtree(focus).map((e) => e.id));
  for (const id of frontier) result.add(id);
  for (let i = 0; i < depth; i++) {
    const next = new Set<Id>();
    for (const id of frontier) {
      for (const r of [...graph.outgoing(id), ...graph.incoming(id)]) {
        const other = r.sourceId === id ? r.targetId : r.sourceId;
        if (!result.has(other)) next.add(other);
      }
    }
    for (const id of next) result.add(id);
    frontier = next;
  }
  for (const id of [...result]) for (const a of graph.ancestors(id)) result.add(a.id);
  return result;
}

export function computeFacts(
  project: Project,
  catalog: Catalog,
  options: ExportOptions = {},
  /** Export just these elements (a change set's neighborhood). */
  only?: ReadonlySet<Id>,
): Facts {
  const graph = new GraphQuery(project, catalog);
  const included = only
    ? new Set(only)
    : options.focus
      ? neighborhood(project, catalog, options.focus, options.depth ?? 1)
      : new Set(project.model.elements.map((e) => e.id));
  // Actors first (they start every story), then by layer, then the rest.
  const layerRank = (e: Element) => {
    if (graph.category(e) === 'actor') return -1;
    const layer = graph.layerOf(e.id);
    return layer ? LAYER_ORDER.indexOf(layer) : LAYER_ORDER.length;
  };
  const elements = project.model.elements
    .filter((e) => included.has(e.id))
    .sort((a, b) => layerRank(a) - layerRank(b) || cmp(a.id, b.id));
  const relations = project.model.relations
    .filter((r) => included.has(r.sourceId) && included.has(r.targetId))
    .sort(
      (a, b) =>
        cmp(a.sourceId, b.sourceId) ||
        cmp(a.type, b.type) ||
        cmp(a.targetId, b.targetId) ||
        cmp(a.id, b.id),
    );
  const relIds = new Set(relations.map((r) => r.id));
  const findings = runRules(project, catalog).filter((f) =>
    f.targetIds.some((id) => included.has(id) || relIds.has(id)),
  );
  return { project, catalog, graph, elements, relations, included, findings };
}

// --- derived sections ------------------------------------------------------------

export interface OwnershipRow {
  storeId: Id;
  /** Deployables that run migrations on it. */
  owners: Id[];
  /** Module named by the schema's `ownedBy` property, if any. */
  ownedBy?: string;
  writers: Id[];
  readers: Id[];
}

const runnerIds = (f: Facts, relations: readonly Relation[]) =>
  [...new Set(relations.map((r) => f.graph.deployableOf(r.sourceId)?.id ?? r.sourceId))].sort();

/** Who migrates, writes and reads each data store (§18.2 "Data ownership"). */
export function ownership(f: Facts): OwnershipRow[] {
  const g = f.graph;
  const units = f.elements.filter((e) => {
    if (g.category(e) !== 'data-at-rest') return false;
    if (g.is(e, 'pg.schema')) return true;
    const insideStore = g.ancestors(e.id).some((a) => g.category(a) === 'data-at-rest');
    const hasSchemas = g.subtree(e.id).some((x) => x.id !== e.id && g.is(x, 'pg.schema'));
    return !insideStore && !hasSchemas;
  });
  return units.map((store) => {
    const db = g.is(store, 'pg.schema') ? g.nearest(store.id, 'pg.database') : undefined;
    const migrations = [
      ...g.incoming(store.id, 'migrates'),
      ...(db ? g.incoming(db.id, 'migrates') : []),
    ];
    const ownedBy = store.properties?.ownedBy;
    return {
      storeId: store.id,
      owners: runnerIds(f, migrations),
      ...(typeof ownedBy === 'string' && ownedBy ? { ownedBy } : {}),
      writers: runnerIds(f, g.incomingToSubtree(store.id, 'writes')),
      readers: runnerIds(f, g.incomingToSubtree(store.id, 'reads')),
    };
  });
}

export interface Invariant {
  text: string;
  /** Where it comes from: a template code, "ownership", or a rule ID. */
  source: string;
}

/** MUST / MUST NOT sentences: templates, data ownership, then the enabled rules (§18.1). */
export function invariants(f: Facts): Invariant[] {
  const out: Invariant[] = [];
  const templates = new Map(
    f.catalog.profiles.flatMap((p) => p.templates ?? []).map((t) => [t.id, t]),
  );
  for (const d of f.project.derivedFrom ?? []) {
    const label = templates.get(d.templateId)?.code ?? d.templateId;
    for (const text of d.invariants ?? []) out.push({ text, source: label });
  }
  for (const row of ownership(f)) {
    if (row.writers.length !== 1) continue;
    const [writer] = row.writers;
    let text = `Only \`${writer}\` MAY write \`${row.storeId}\`.`;
    if (row.owners.length === 1) text += ` Only \`${row.owners[0]}\` MAY run migrations on it.`;
    out.push({ text, source: 'ownership' });
  }
  const settings = f.project.settings;
  for (const rule of activeRules(f.project, allRules(f.catalog))) {
    if (!rule.invariant) continue;
    // Only rules about something the model has: no React rules for a backend service.
    if (
      rule.appliesTo &&
      !f.elements.some((e) => rule.appliesTo!.some((sel) => f.graph.is(e, sel)))
    )
      continue;
    const text = typeof rule.invariant === 'string' ? rule.invariant : rule.invariant(settings);
    out.push({ text, source: rule.id });
  }
  return out;
}

export interface KnownIssue {
  ruleId: string;
  title: string;
  targetIds: Id[];
  status: 'open' | 'suppressed';
  reason: string;
}

/** Open errors and warnings, and every suppressed finding with its reason. */
export function knownIssues(f: Facts): KnownIssue[] {
  return f.findings
    .filter((x) => x.suppressed || x.severity !== 'info')
    .map((x) => ({
      ruleId: x.ruleId,
      title: x.title,
      targetIds: x.targetIds,
      status: x.suppressed ? 'suppressed' : 'open',
      reason: x.suppressed ? x.suppressed.reason : x.message,
    }));
}

/** Terms from the project note titled "Glossary": `term: definition` lines. */
export function glossary(project: Project): { term: string; definition: string }[] {
  const note = project.notes.find((n) => n.title.trim().toLowerCase() === 'glossary');
  if (!note) return [];
  return note.body
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .map((line) => /^([^:]+):\s*(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ term: m[1]!.trim(), definition: m[2]!.trim() }));
}

/** Learning texts of all profiles, by ID. */
export function docsById(catalog: Catalog): Map<string, LearningDoc> {
  return new Map(catalog.profiles.flatMap((p) => p.content?.docs ?? []).map((d) => [d.id, d]));
}

export interface UsedConcept {
  id: string;
  name: string;
  summary: string;
  kind: 'concept' | 'relation';
}

/** Up to the first full stop that ends a sentence ("Node.js" does not end one). */
const firstSentence = (text: string) => /^.+?[.!?](?=\s|$)/s.exec(text)?.[0].trim() ?? text;

/** Concepts and relation types that appear in the export, with a one-line summary. */
export function conceptsUsed(f: Facts): UsedConcept[] {
  const docs = docsById(f.catalog);
  const concepts = [...new Set(f.elements.map((e) => e.kind))].sort().flatMap((id) => {
    const c = f.catalog.concepts.get(id);
    if (!c) return [];
    return [
      {
        id,
        name: c.name,
        summary: docs.get(id)?.summary ?? firstSentence(c.docs),
        kind: 'concept' as const,
      },
    ];
  });
  const types = [...new Set(f.relations.map((r) => r.type))].sort().flatMap((id) => {
    const t = f.catalog.relationTypes.get(id);
    if (!t) return [];
    return [
      {
        id,
        name: t.name,
        summary: docs.get(id)?.summary ?? firstSentence(t.docs),
        kind: 'relation' as const,
      },
    ];
  });
  return [...concepts, ...types];
}

/** Short pattern names of the templates the project was made from ("hexagonal-service"). */
export function patterns(project: Project): string[] {
  return [
    ...new Set((project.derivedFrom ?? []).map((d) => d.templateId.replace(/^[a-z]+\./, ''))),
  ];
}
