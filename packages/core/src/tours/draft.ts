import { GraphQuery } from '../graph';
import type { Catalog } from '../catalog';
import { slugify, uniqueId } from '../ids';
import type { Element, Id, Project, Tour, TourStep } from '../schema';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * A first tour of a project, for the author to edit (Implementation.md §17.8):
 * who uses the system → entry points → each deployable along synchronous calls →
 * data and ownership → asynchronous parts → everything else.
 */
export function draftTour(project: Project, catalog: Catalog): Tour {
  const g = new GraphQuery(project, catalog);
  const known = (id: string) =>
    catalog.concepts.has(id) || catalog.relationTypes.has(id) || docIds(catalog).has(id);
  const steps: Omit<TourStep, 'id'>[] = [];
  const covered = new Set<Id>();
  const name = (id: Id) => g.element(id)?.name ?? id;
  const conceptsOf = (els: Element[]) => [...new Set(els.map((e) => e.kind))].filter(known).sort();
  const cover = (els: Element[]) => {
    for (const e of els) for (const x of g.subtree(e.id)) covered.add(x.id);
  };

  // 1. Who uses the system, and where they enter.
  const actors = g.elements
    .filter((e) => g.category(e) === 'actor')
    .sort((a, b) => cmp(a.id, b.id));
  const entryIds = new Set<Id>();
  for (const a of actors)
    for (const r of g.outgoing(a.id, 'calls'))
      entryIds.add(g.deployableOf(r.targetId)?.id ?? r.targetId);
  if (actors.length > 0) {
    steps.push({
      title: 'Who uses it',
      body: `${list(actors.map((a) => `**${a.name}**`))} use${actors.length === 1 ? 's' : ''} the system through ${list([...entryIds].sort().map((id) => `**${name(id)}**`)) || 'nothing yet'}.`,
      elementIds: [...actors.map((a) => a.id), ...[...entryIds].sort()],
      relationIds: actors.flatMap((a) => g.outgoing(a.id, 'calls').map((r) => r.id)).sort(),
    });
    cover(actors);
  }

  // 2. Deployables, breadth-first along synchronous calls from the entry points.
  const deployables = g.elements.filter(
    (e) => g.category(e) === 'deployable' || g.category(e) === 'routing',
  );
  const queue = [...entryIds].sort();
  const seen = new Set<Id>(queue);
  const order: Id[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const next = g
      .outgoingFromSubtree(id, 'calls')
      .filter((r) => r.mode !== 'async')
      .map((r) => g.deployableOf(r.targetId)?.id ?? r.targetId)
      .filter((t) => deployables.some((d) => d.id === t) && !seen.has(t))
      .sort();
    for (const t of next) {
      seen.add(t);
      queue.push(t);
    }
  }
  for (const d of deployables.sort((a, b) => cmp(a.id, b.id)))
    if (!seen.has(d.id)) order.push(d.id);
  for (const id of order) {
    const d = g.element(id);
    if (!d || covered.has(id)) continue;
    const inside = g.subtree(id);
    const concept = catalog.concepts.get(d.kind)?.name ?? d.kind;
    const calls = [
      ...new Set(
        g.outgoingFromSubtree(id, 'calls').map((r) => g.deployableOf(r.targetId)?.id ?? r.targetId),
      ),
    ]
      .filter((t) => t !== id)
      .sort();
    const data = [
      ...new Set(g.outgoingFromSubtree(id, 'reads', 'writes').map((r) => r.targetId)),
    ].sort();
    const sentences = [
      `**${d.name}** is a ${concept.toLowerCase()}.`,
      d.responsibilities?.length ? `It is responsible for: ${d.responsibilities.join('; ')}.` : '',
      inside.length > 1
        ? `Inside it: ${list(inside.filter((x) => x.id !== id).map((x) => x.name))}.`
        : '',
      calls.length ? `It calls ${list(calls.map(name))}.` : '',
      data.length ? `It works with the data in ${list(data.map(name))}.` : '',
    ].filter(Boolean);
    steps.push({
      title: d.name,
      body: sentences.join(' '),
      elementIds: inside.map((x) => x.id),
      relationIds: g
        .outgoingFromSubtree(id)
        .map((r) => r.id)
        .sort(),
      conceptIds: conceptsOf(inside),
    });
    cover([d]);
  }

  // 3. Data stores and who owns them.
  const stores = g.elements
    .filter(
      (e) =>
        g.category(e) === 'data-at-rest' &&
        !g.ancestors(e.id).some((a) => g.category(a) === 'data-at-rest'),
    )
    .filter((e) => !covered.has(e.id))
    .sort((a, b) => cmp(a.id, b.id));
  if (stores.length > 0) {
    const owners = stores.flatMap((s) =>
      g
        .incomingToSubtree(s.id, 'migrates')
        .map((r) => `${name(r.sourceId)} owns ${name(r.targetId)}`),
    );
    steps.push({
      title: 'The data',
      body: [
        `The data lives in ${list(stores.map((s) => `**${s.name}**`))}.`,
        owners.length ? `${[...new Set(owners)].join('; ')} (it runs the migrations).` : '',
        'Each schema has one owner; other parts get the data through the owner.',
      ]
        .filter(Boolean)
        .join(' '),
      elementIds: stores.flatMap((s) => g.subtree(s.id).map((x) => x.id)),
      relationIds: stores
        .flatMap((s) => g.incomingToSubtree(s.id, 'migrates').map((r) => r.id))
        .sort(),
      conceptIds: conceptsOf(stores.flatMap((s) => g.subtree(s.id))),
    });
    cover(stores);
  }

  // 4. Queues, channels and brokers.
  const async = g.elements
    .filter((e) => g.category(e) === 'data-in-motion' && !covered.has(e.id))
    .sort((a, b) => cmp(a.id, b.id));
  if (async.length > 0) {
    const producers = [
      ...new Set(
        async.flatMap((q) =>
          g.incoming(q.id, 'publishes', 'notifies').map((r) => name(r.sourceId)),
        ),
      ),
    ];
    const consumers = [
      ...new Set(
        async.flatMap((q) => g.incoming(q.id, 'consumes', 'listens').map((r) => name(r.sourceId))),
      ),
    ];
    steps.push({
      title: 'Work in the background',
      body: [
        `${list(async.map((q) => `**${q.name}**`))} carr${async.length === 1 ? 'ies' : 'y'} work that does not happen during a request.`,
        producers.length ? `${list(producers)} add${producers.length === 1 ? 's' : ''} work;` : '',
        consumers.length ? `${list(consumers)} do${consumers.length === 1 ? 'es' : ''} it.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      elementIds: async.map((q) => q.id),
      relationIds: async.flatMap((q) => g.incoming(q.id).map((r) => r.id)).sort(),
      conceptIds: conceptsOf(async),
    });
    cover(async);
  }

  // 5. Everything else at the top level.
  const rest = g.elements
    .filter((e) => !e.parentId && !covered.has(e.id) && g.category(e) !== 'group')
    .sort((a, b) => cmp(a.id, b.id));
  if (rest.length > 0)
    steps.push({
      title: 'Other parts',
      body: `Also part of the picture: ${list(rest.map((e) => `**${e.name}**`))}.`,
      elementIds: rest.map((e) => e.id),
      relationIds: [],
      conceptIds: conceptsOf(rest),
    });

  if (steps.length === 0)
    steps.push({
      title: 'Start here',
      body: 'The diagram is empty. Add the people who use the system and the parts they use.',
      elementIds: [],
      relationIds: [],
    });

  return {
    id: uniqueId(`tour.${slugify(project.id)}`, new Set(project.tours.map((t) => t.id))),
    title: `Tour: ${project.name}`,
    description: 'A first walkthrough, drafted from the diagram. Edit it to tell the story.',
    audience: 'any',
    // Steps without linked concepts leave the field out.
    steps: steps.map(({ conceptIds, ...s }, i) => ({
      id: `step-${i + 1}`,
      ...s,
      ...(conceptIds?.length ? { conceptIds } : {}),
    })),
  };
}

function docIds(catalog: Catalog): Set<string> {
  return new Set(catalog.profiles.flatMap((p) => p.content?.docs ?? []).map((d) => d.id));
}
