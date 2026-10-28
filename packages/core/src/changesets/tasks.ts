import type { Catalog } from '../catalog';
import { diffProjects } from '../diff';
import { computeFacts, invariants } from '../export/facts';
import type { Invariant } from '../export/facts';
import { GraphQuery } from '../graph';
import { allRules } from '../rules';
import type { ChangeSet, Element, Id, Project, Relation, Task } from '../schema';
import { effectiveProject } from './state';

/** "A needs B to exist first" when A has one of these relations to B (§16.4). */
const DEPENDS = [
  'reads',
  'writes',
  'calls',
  'implements',
  'uses-port',
  'depends-on',
  'enqueues',
  'processes',
  'migrates',
  'consumes',
  'listens',
  'notifies',
  'publishes',
];

/**
 * Tie-break order of the topological sort: data first, then ports, domain, adapters, use
 * cases, route handlers, deployables, BFFs and gateways, and the frontend last.
 */
function rank(g: GraphQuery, e: Element): number {
  const cat = g.category(e);
  const frontend =
    cat === 'ui' ||
    cat === 'client-state' ||
    g.layerOf(e.id) === 'presentation' ||
    g.layerOf(g.deployableOf(e.id)?.id ?? '') === 'presentation';
  if (frontend) return 9;
  if (/(^|\.)(bff|gateway|ws-gateway|api-gateway)$/.test(e.kind) || /gateway/.test(e.kind))
    return 8;
  switch (cat) {
    case 'data-at-rest':
      return 0;
    case 'data-in-motion':
    case 'external':
      return 1;
    case 'port':
    case 'schema':
    case 'event':
      return 2;
    case 'domain-core':
    case 'domain-object':
      return 3;
    case 'adapter':
      return 4;
    case 'deployable':
      return 7;
    case 'routing':
    case 'security':
      return 6;
  }
  if (/route-handler|endpoint|middleware|controller/.test(e.kind)) return 6;
  return 5;
}

const VERBS: Record<string, string> = {
  calls: 'Call',
  reads: 'Read',
  writes: 'Write',
  enqueues: 'Enqueue to',
  processes: 'Process jobs from',
  consumes: 'Consume',
  publishes: 'Publish to',
  implements: 'Implement',
  'uses-port': 'Use',
  'depends-on': 'Depend on',
  migrates: 'Run migrations for',
  notifies: 'Notify',
  listens: 'Listen on',
  renders: 'Render',
  navigates: 'Link to',
  emits: 'Emit',
  handles: 'Handle',
  'authenticates-with': 'Authenticate with',
  serves: 'Serve',
};

/** "Enqueue to `jobs.payments` (payment.succeeded) in the same transaction". */
export function relationStep(r: Relation, catalog: Catalog): string {
  const name = catalog.relationTypes.get(r.type)?.name ?? r.type;
  const verb = VERBS[r.type] ?? name.charAt(0).toUpperCase() + name.slice(1);
  const parts = [`${verb} \`${r.targetId}\``];
  if (r.label) parts.push(`(${r.label})`);
  if (r.protocol) parts.push(`over ${r.protocol}`);
  if (r.via) parts.push(`via ${r.via}`);
  if (r.inTransaction) parts.push('in the same transaction');
  return parts.join(' ');
}

function childStep(e: Element, catalog: Catalog): string {
  const method = e.properties?.method;
  const path = e.properties?.path;
  if (typeof method === 'string' && typeof path === 'string') return `Expose \`${method} ${path}\``;
  const concept = catalog.concepts.get(e.kind)?.name ?? e.kind;
  return `Add ${concept.toLowerCase()} \`${e.name}\``;
}

/**
 * Invariants about some elements: the template and ownership sentences that name one of
 * them, and the rules about their kinds (§16.4 step 5).
 */
export function invariantsAbout(
  project: Project,
  catalog: Catalog,
): (ids: readonly Id[]) => Invariant[] {
  const g = new GraphQuery(project, catalog);
  const all = invariants(computeFacts(project, catalog));
  const rules = new Map(allRules(catalog).map((r) => [r.id, r]));
  return (ids) =>
    all.filter((i) => {
      if (ids.some((id) => i.text.includes(`\`${id}\``))) return true;
      const sel = rules.get(i.source)?.appliesTo;
      return Boolean(sel?.some((s) => ids.some((id) => g.is(g.element(id), s))));
    });
}

/**
 * Invariants of a task: sentences that name its elements in full, the rules about its
 * kinds by ID (the plan lists their text once).
 */
function invariantLines(list: readonly Invariant[], rules: ReadonlySet<string>): string[] {
  const named = list.filter((i) => !rules.has(i.source));
  const ruleIds = list.filter((i) => rules.has(i.source)).map((i) => i.source);
  return [
    ...named.map((i) => `- MUST respect: ${i.text} (${i.source})`),
    ...(ruleIds.length ? [`- Rules: ${ruleIds.join(', ')}`] : []),
  ];
}

interface Node {
  /** The task's elements; the first one names it. */
  ids: Id[];
  steps: string[];
  added: boolean;
}

/**
 * Tasks for a change set (Implementation.md §16.4): one per added or changed element, in
 * build order. Leaf elements added inside another element of the change (endpoints, ports,
 * DTOs) are steps of that element's task. Removals come last. Tasks whose title matches one
 * in `previous` keep its `done` flag.
 */
export function generateTasks(
  baseline: Project,
  changeSet: ChangeSet,
  catalog: Catalog,
  previous: readonly Task[] = changeSet.tasks ?? [],
): Task[] {
  const { effective } = effectiveProject(baseline, changeSet, catalog);
  const d = diffProjects(baseline, effective);
  const g = new GraphQuery(effective, catalog);
  const before = new GraphQuery(baseline, catalog);
  const skip = (e: Element | undefined) =>
    !e || g.category(e) === 'actor' || g.category(e) === 'group';

  const added = new Set(d.added.elements);
  const items = new Set<Id>();
  const add = (id: Id) => {
    if (!skip(g.element(id))) items.add(id);
  };
  for (const id of d.added.elements) add(id);
  for (const c of d.changed) if (c.kind === 'element') add(c.id);
  const addedRels = d.added.relations.map((id) => g.relation(id)!);
  const changedRels = d.changed.filter((c) => c.kind === 'relation');
  const removedRels = d.removed.relations
    .map((id) => before.relation(id)!)
    .filter((r) => g.element(r.sourceId));
  for (const r of addedRels) add(r.sourceId);
  for (const c of changedRels) add(g.relation(c.id)!.sourceId);
  for (const r of removedRels) add(r.sourceId);

  const itemParent = (id: Id): Id | undefined => g.ancestors(id).find((a) => items.has(a.id))?.id;
  const isDep = (r: Relation) => g.typeIs(r, ...DEPENDS);

  // Leaves added inside another task element, with no needs of their own, become steps.
  const owner = new Map<Id, Id>();
  for (const id of items) {
    const parent = itemParent(id);
    if (!parent || !added.has(id)) continue;
    const hasItemChildren = [...items].some((x) => x !== id && itemParent(x) === id);
    const needs = g.outgoing(id).some((r) => isDep(r) && items.has(r.targetId));
    if (!hasItemChildren && !needs) owner.set(id, parent);
  }
  const taskOf = (id: Id): Id | undefined => {
    if (!items.has(id)) return undefined;
    let cur = id;
    while (owner.has(cur)) cur = owner.get(cur)!;
    return cur;
  };

  const nodes = new Map<Id, Node>();
  for (const id of items)
    if (!owner.has(id)) nodes.set(id, { ids: [id], steps: [], added: added.has(id) });
  for (const id of [...owner.keys()].sort()) {
    const node = nodes.get(taskOf(id)!)!;
    node.ids.push(id);
    node.steps.push(childStep(g.element(id)!, catalog));
  }
  for (const c of d.changed) {
    if (c.kind !== 'element' || !nodes.has(c.id)) continue;
    const fields = c.fields.filter((f) => f !== 'layout');
    if (fields.length) nodes.get(c.id)!.steps.push(`Update ${fields.join(', ')}`);
  }
  for (const r of addedRels) {
    const t = taskOf(r.sourceId);
    if (t) nodes.get(t)!.steps.push(relationStep(r, catalog));
  }
  for (const c of changedRels) {
    const r = g.relation(c.id)!;
    const t = taskOf(r.sourceId);
    if (t)
      nodes.get(t)!.steps.push(`Change how it ${r.type} \`${r.targetId}\`: ${c.fields.join(', ')}`);
  }
  for (const r of removedRels) {
    const t = taskOf(r.sourceId);
    if (t) nodes.get(t)!.steps.push(`Stop: ${r.type} \`${r.targetId}\``);
  }

  // Dependency edges between tasks: relations of the needed kinds, and containment.
  const edges = new Map<Id, Set<Id>>([...nodes.keys()].map((id) => [id, new Set<Id>()]));
  const link = (a: Id | undefined, b: Id | undefined) => {
    if (a && b && a !== b) edges.get(a)!.add(b);
  };
  for (const r of effective.model.relations)
    if (isDep(r)) link(taskOf(r.sourceId), taskOf(r.targetId));
  for (const id of nodes.keys()) link(id, taskOf(itemParent(id) ?? ''));

  const order = buildOrder([...nodes.keys()], edges, (id) => rank(g, g.element(id)!));

  const invariantsFor = invariantsAbout(effective, catalog);
  const rules = new Set(allRules(catalog).map((r) => r.id));

  const done = new Map(previous.map((t) => [t.title, t.done]));
  const tasks: Task[] = [];
  const taskId = new Map<Id, Id>();
  for (const [n, group] of order.entries()) {
    const id = `task-${n + 1}`;
    for (const x of group) taskId.set(x, id);
    const parts = group.map((x) => nodes.get(x)!);
    const elementIds = parts.flatMap((p) => p.ids);
    const lead = g.element(group[0]!)!;
    const verb = parts.every((p) => p.added)
      ? 'Create'
      : parts.some((p) => p.added)
        ? 'Build'
        : 'Change';
    const title = `${verb} ${group.join(' + ')}`;
    const concept = catalog.concepts.get(lead.kind)?.name ?? lead.kind;
    const code = [
      ...new Set(
        group.flatMap((x) => {
          const e = g.element(x)!;
          return e.codePaths?.length
            ? e.codePaths
            : (g.ancestors(x).find((a) => a.codePaths?.length)?.codePaths ?? []);
        }),
      ),
    ];
    const lines = [
      `${concept} "${lead.name}"${lead.tech ? ` (${lead.tech})` : ''}${lead.responsibilities?.length ? `: ${lead.responsibilities.join('; ')}` : ''}.`,
      ...(group.length > 1
        ? ['These elements need each other (a cycle in the change); build them together.']
        : []),
      ...(code.length ? [`Code: ${code.map((c) => `\`${c}\``).join(', ')}`] : []),
      ...parts.flatMap((p) => p.steps).map((s) => `- ${s}`),
      ...invariantLines(invariantsFor(elementIds), rules),
    ];
    const deps = new Set<Id>();
    for (const x of group)
      for (const y of edges.get(x)!) {
        const t = taskId.get(y);
        if (t && t !== id) deps.add(t);
      }
    tasks.push({
      id,
      title,
      detail: lines.join('\n'),
      elementIds,
      dependsOn: [...deps].sort(),
      done: done.get(title) ?? false,
    });
  }

  // Removals last: the top-most removed elements only (their content goes with them).
  const removed = new Set(d.removed.elements);
  for (const id of d.removed.elements) {
    const e = before.element(id)!;
    if (before.category(e) === 'actor') continue;
    if (e.parentId && removed.has(e.parentId)) continue;
    const users = [
      ...new Set(
        before
          .incomingToSubtree(id)
          .map((r) => r.sourceId)
          .filter((s) => g.element(s) && !removed.has(s)),
      ),
    ].sort();
    const title = `Remove ${id}`;
    tasks.push({
      id: `task-${tasks.length + 1}`,
      title,
      detail: [
        `Delete ${catalog.concepts.get(e.kind)?.name ?? e.kind} "${e.name}".`,
        ...(e.codePaths?.length ? [`Code: ${e.codePaths.map((c) => `\`${c}\``).join(', ')}`] : []),
        ...users.map((u) => `- Make sure \`${u}\` no longer uses it`),
      ].join('\n'),
      elementIds: before.subtree(id).map((x) => x.id),
      dependsOn: [],
      done: done.get(title) ?? false,
    });
  }
  return tasks;
}

/**
 * Topological order of `ids` where an edge a → b means b comes first. Strongly connected
 * groups (cycles) become one entry. Ties go to the lower rank, then the lower ID.
 */
function buildOrder(
  ids: readonly Id[],
  edges: ReadonlyMap<Id, ReadonlySet<Id>>,
  rankOf: (id: Id) => number,
): Id[][] {
  // Tarjan's strongly connected components.
  const index = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const comps: Id[][] = [];
  let counter = 0;
  const visit = (v: Id) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: Id[] = [];
      let w: Id;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      comps.push(comp.sort((a, b) => rankOf(a) - rankOf(b) || (a < b ? -1 : 1)));
    }
  };
  for (const id of [...ids].sort()) if (!index.has(id)) visit(id);

  const compOf = new Map<Id, number>();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const needs = comps.map(() => new Set<number>());
  comps.forEach((c, i) => {
    for (const id of c)
      for (const w of edges.get(id) ?? []) if (compOf.get(w) !== i) needs[i]!.add(compOf.get(w)!);
  });
  const key = (i: number) => {
    const c = comps[i]!;
    return { rank: Math.min(...c.map(rankOf)), id: c[0]! };
  };
  const out: Id[][] = [];
  const placed = new Set<number>();
  while (placed.size < comps.length) {
    const ready = comps
      .map((_, i) => i)
      .filter((i) => !placed.has(i) && [...needs[i]!].every((n) => placed.has(n)));
    ready.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x.rank - y.rank || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    });
    const next = ready[0]!;
    placed.add(next);
    out.push(comps[next]!);
  }
  return out;
}
