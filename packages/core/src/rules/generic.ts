import type { GraphQuery } from '../graph';
import type { Element, Id, Relation } from '../schema';
import type { RawFinding, Rule, RulePack } from './types';

/** Rule packs (Implementation.md §11.4). `core` and the project's profile are always on. */
export const RULE_PACKS: RulePack[] = [
  {
    id: 'core',
    name: 'Core',
    description: 'Cycles, overloaded elements, orphan queues, disconnected elements. Always on.',
  },
  { id: 'frontend', name: 'Frontend', description: 'Browser code and data access.' },
  {
    id: 'security',
    name: 'Security',
    description: 'Authentication on public entry points, sensitive data, token storage.',
  },
  {
    id: 'concurrency',
    name: 'Concurrency and parallelism',
    description:
      'Lost updates, connection pools, CPU work on the event loop, retries of serializable transactions.',
  },
  { id: 'api', name: 'API design', description: 'Idempotent retries, pagination.' },
  {
    id: 'event-driven',
    name: 'Event-driven',
    description: 'Dual writes, dead letters, orphan queues, callbacks to the publisher.',
  },
  {
    id: 'microservices',
    name: 'Microservices',
    description: 'Shared databases, synchronous call chains and cycles, frontend fan-out.',
  },
  { id: 'layered', name: 'Layered', description: 'Layers are not skipped.' },
  { id: 'hexagonal', name: 'Hexagonal', description: 'The domain depends on nothing outside it.' },
  { id: 'fsd', name: 'Feature-Sliced Design', description: 'Features do not import each other.' },
];

/** Packs a new project starts with; architecture-style packs come with templates. */
export const DEFAULT_RULE_PACKS = [
  'core',
  'frontend',
  'security',
  'concurrency',
  'api',
  'event-driven',
  'microservices',
];

// --- helpers -----------------------------------------------------------------

const names = (g: GraphQuery, ids: Iterable<Id>) =>
  [...ids].map((id) => g.element(id)?.name ?? id).join(', ');

const isFrontend = (g: GraphQuery, el: Element | undefined) =>
  !!el &&
  (g.is(el, 'group:Frontend') || g.category(el) === 'ui' || g.category(el) === 'client-state');

/** The deployable that runs this element, or the element itself when it is not inside one. */
const runner = (g: GraphQuery, id: Id): Id | undefined => g.deployableOf(id)?.id;

/** Topmost data-at-rest element at or above `id` ("the database", not the table). */
function storeRoot(g: GraphQuery, id: Id): Element | undefined {
  const chain = [g.element(id), ...g.ancestors(id)].filter(
    (e): e is Element => !!e && g.category(e) === 'data-at-rest',
  );
  return chain[chain.length - 1];
}

const isSync = (r: Relation) => r.mode !== 'async';

// --- rules -------------------------------------------------------------------

const sharedDatabase: Rule = {
  id: 'AP-001',
  title: 'Shared database between services',
  severity: 'warning',
  packs: ['microservices'],
  learnId: 'pg.table',
  rationale:
    'When two services write the same database, a change to a table in one service can break the other, and neither can be deployed alone. Give each service its own store, or let one service own the data and offer it through an API or events.',
  check: ({ graph: g }) => {
    const out: RawFinding[] = [];
    for (const store of g.elements.filter(
      (e) => g.category(e) === 'data-at-rest' && storeRoot(g, e.id) === e,
    )) {
      const writes = g.incomingToSubtree(store.id, 'writes');
      const writers = new Set(writes.map((r) => runner(g, r.sourceId)).filter((x): x is Id => !!x));
      if (writers.size < 2) continue;
      out.push({
        targetIds: [store.id],
        relatedIds: [...writers, ...writes.map((r) => r.id)],
        message: `${store.name} is written by ${names(g, writers)}. Services that share a database are coupled: a change to a table in one can break the other.`,
      });
    }
    return out;
  },
};

const frontendToDatabase: Rule = {
  id: 'AP-002',
  title: 'Frontend talks to a database',
  severity: 'error',
  packs: ['frontend'],
  rationale:
    'Code in the browser can be read and changed by anyone. If it talks to a database directly, the credentials are public and nothing checks what the user may do. Put a backend in between.',
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'reads', 'writes'))
      .filter((r) => g.category(g.element(r.targetId)!) === 'data-at-rest')
      .filter(
        (r) => isFrontend(g, g.element(r.sourceId)) || isFrontend(g, g.deployableOf(r.sourceId)),
      )
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${g.element(r.sourceId)!.name} (browser code) ${r.type} ${g.element(r.targetId)!.name} directly. Go through a backend service.`,
      })),
};

const cycles: Rule = {
  id: 'AP-003',
  title: 'Cyclic dependency',
  severity: 'warning',
  packs: ['core'],
  rationale:
    'Parts that depend on each other in a circle cannot be changed, tested or deployed one at a time. Break the cycle: move the shared part into its own module, depend on an interface, or send an event instead of a call.',
  check: ({ graph: g }) => {
    const modules = (id: Id) => (g.category(g.element(id)!) === 'module' ? id : undefined);
    const found = [...g.cycles(['depends-on']), ...g.cycles(['calls'], modules)];
    const seen = new Set<string>();
    return found
      .filter((c) => !seen.has(c.join()) && seen.add(c.join()))
      .map((c) => ({
        targetIds: c,
        message: `${names(g, c)} depend on each other in a cycle.`,
      }));
  },
};

const dependencyRule: Rule = {
  id: 'AP-004',
  title: 'Domain depends on infrastructure',
  severity: 'warning',
  packs: ['hexagonal'],
  learnId: 'topic.models',
  rationale:
    'The domain holds the business rules. If it imports database, HTTP or framework code, every infrastructure change touches the rules, and the rules cannot be tested alone. Let the domain depend on a port (an interface) and let an adapter implement it.',
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'depends-on', 'calls', 'reads', 'writes'))
      .filter((r) => g.layerOf(r.sourceId) === 'domain')
      .filter((r) =>
        ['infrastructure', 'presentation', 'data'].includes(g.layerOf(r.targetId) ?? ''),
      )
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${g.element(r.sourceId)!.name} (domain) depends on ${g.element(r.targetId)!.name} (${g.layerOf(r.targetId)}). Depend on a port instead, and let an adapter implement it.`,
      })),
};

const layerSkipping: Rule = {
  id: 'AP-005',
  title: 'Layer skipping',
  severity: 'warning',
  packs: ['layered'],
  rationale:
    'In a layered design each layer only talks to the one below it. When presentation code reaches the data layer directly, business rules get duplicated or skipped. Go through the application layer.',
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'calls', 'reads', 'writes', 'depends-on'))
      .filter(
        (r) =>
          g.layerOf(r.sourceId) === 'presentation' && !isFrontend(g, g.deployableOf(r.sourceId)),
      )
      .filter((r) => g.layerOf(r.targetId) === 'data' || g.layerOf(r.targetId) === 'infrastructure')
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${g.element(r.sourceId)!.name} (presentation) reaches ${g.element(r.targetId)!.name} (${g.layerOf(r.targetId)}) without the application layer.`,
      })),
};

const distributedMonolith: Rule = {
  id: 'AP-006',
  title: 'Distributed monolith',
  severity: 'warning',
  packs: ['microservices'],
  rationale:
    'Services that call each other synchronously in a circle fail together and must be deployed together: you pay for separate services without getting their independence. Make one direction asynchronous (events), or merge them.',
  check: ({ graph: g }) =>
    g
      .cycles(['calls'], (id) => runner(g, id), isSync)
      .filter((c) => c.length > 1)
      .map((c) => ({
        targetIds: c,
        message: `${names(g, c)} call each other synchronously in a cycle. They fail and deploy together.`,
      })),
};

const chattyChain: Rule = {
  id: 'AP-007',
  title: 'Long synchronous call chain',
  severity: 'warning',
  packs: ['microservices'],
  learnId: 'topic.event-loop-and-parallelism',
  rationale:
    'Every synchronous hop adds latency and another way to fail: the user waits for the slowest service in the chain, and one outage breaks the whole request. Shorten the chain with events, caching or by merging services.',
  check: ({ graph: g, settings }) => {
    const limit = settings.thresholds.syncDepth;
    const entries = g.elements.filter(
      (e) =>
        g.category(e) === 'deployable' &&
        !isFrontend(g, e) &&
        g.incomingToSubtree(e.id, 'calls').some((r) => {
          const from = g.element(r.sourceId);
          return g.category(from!) === 'actor' || isFrontend(g, g.deployableOf(r.sourceId) ?? from);
        }),
    );
    const out: RawFinding[] = [];
    for (const entry of entries) {
      const chain = g.longestChain(entry.id, ['calls'], (id) => {
        const d = g.deployableOf(id);
        return d && !isFrontend(g, d) ? d.id : undefined;
      });
      if (chain.length > limit) {
        out.push({
          targetIds: [entry.id],
          relatedIds: chain,
          message: `A request to ${entry.name} waits for ${chain.length} services in a row (${names(g, chain)}). The limit is ${limit}.`,
        });
      }
    }
    return out;
  },
};

const godElement: Rule = {
  id: 'AP-008',
  title: 'Element does too much',
  severity: 'warning',
  packs: ['core'],
  rationale:
    'An element connected to almost everything, or with a long list of responsibilities, becomes the place every change goes through. Split it by subdomain or by responsibility.',
  check: ({ graph: g, settings }) =>
    g.elements
      .filter((e) => ['deployable', 'module'].includes(g.category(e) ?? ''))
      .flatMap((e) => {
        const d = g.degree(e.id);
        const resp = e.responsibilities?.length ?? 0;
        const reasons = [
          d.in > settings.thresholds.fanIn ? `${d.in} elements depend on it` : '',
          d.out > settings.thresholds.fanOut ? `it depends on ${d.out} elements` : '',
          resp > 7 ? `it has ${resp} responsibilities` : '',
        ].filter(Boolean);
        return reasons.length
          ? [{ targetIds: [e.id], message: `${e.name} does too much: ${reasons.join(', ')}.` }]
          : [];
      }),
};

const frontendFanOut: Rule = {
  id: 'AP-009',
  title: 'Frontend calls many services',
  severity: 'warning',
  packs: ['microservices'],
  rationale:
    'When the browser calls many backend services directly, it has to know all of them, make many slow requests, and handle every partial failure. Add a backend-for-frontend or an API gateway.',
  check: ({ graph: g, settings }) =>
    g.elements
      .filter((e) => g.category(e) === 'deployable' && isFrontend(g, e))
      .flatMap((app) => {
        const targets = new Set(
          g
            .outgoingFromSubtree(app.id, 'calls')
            .map((r) => g.deployableOf(r.targetId))
            .filter((d): d is Element => !!d && !isFrontend(g, d))
            .map((d) => d.id),
        );
        return targets.size > settings.thresholds.frontendDirectServices
          ? [
              {
                targetIds: [app.id],
                relatedIds: [...targets],
                message: `${app.name} calls ${targets.size} services directly (${names(g, targets)}). Add a backend-for-frontend or a gateway.`,
              },
            ]
          : [];
      }),
};

/** Whether an entry point shows any sign of authentication in the model. */
export function hasAuth(g: GraphQuery, entry: Element): boolean {
  const subtree = g.subtree(entry.id);
  return (
    g.outgoingFromSubtree(entry.id, 'authenticates-with').length > 0 ||
    subtree.some((e) => g.category(e) === 'security' || e.properties?.kind === 'auth') ||
    g
      .incoming(entry.id, 'calls')
      .some((r) => typeof r.properties?.auth === 'string' && r.properties.auth !== 'none')
  );
}

/** Backend elements that users reach directly, or through browser code. */
export function publicEntries(g: GraphQuery): Element[] {
  return g.elements.filter(
    (e) =>
      ['deployable', 'routing'].includes(g.category(e) ?? '') &&
      !isFrontend(g, e) &&
      g.incoming(e.id, 'calls').some((r) => {
        const from = g.element(r.sourceId)!;
        return g.category(from) === 'actor' || isFrontend(g, g.deployableOf(r.sourceId) ?? from);
      }),
  );
}

const publicWithoutAuth: Rule = {
  id: 'AP-010',
  title: 'Public entry point without authentication',
  severity: 'warning',
  packs: ['security'],
  learnId: 'topic.authentication',
  rationale:
    'Anything the browser can reach, anyone on the internet can reach. Show how the entry point checks who is calling: an auth provider, a gateway that checks tokens, or an auth middleware.',
  check: ({ graph: g }) =>
    publicEntries(g)
      .filter((e) => !hasAuth(g, e))
      .map((e) => ({
        targetIds: [e.id],
        message: `${e.name} is reachable from the browser, and the model shows no authentication. Connect it to an auth provider, or mark how calls are authenticated.`,
      })),
};

/** Producers and consumers of a queue, topic or channel. */
function messaging(g: GraphQuery, q: Element) {
  return {
    producers: g.incoming(q.id, 'publishes', 'notifies'),
    consumers: g.incoming(q.id, 'consumes', 'listens'),
  };
}

const orphanMessaging: Rule = {
  id: 'AP-011',
  title: 'Queue without producers or consumers',
  severity: 'warning',
  packs: ['core', 'event-driven'],
  rationale:
    'A queue that nobody reads fills up and its messages are lost to the business; a queue nobody writes to is dead code, or a missing producer. Connect the missing side or remove the queue.',
  check: ({ graph: g }) =>
    g.elements
      .filter((e) => g.category(e) === 'data-in-motion')
      .flatMap((q) => {
        const { producers, consumers } = messaging(g, q);
        if (producers.length > 0 && consumers.length === 0)
          return [
            {
              targetIds: [q.id],
              relatedIds: producers.map((r) => r.id),
              message: `Messages go into ${q.name}, but nothing reads them.`,
            },
          ];
        if (consumers.length > 0 && producers.length === 0)
          return [
            {
              targetIds: [q.id],
              relatedIds: consumers.map((r) => r.id),
              message: `${q.name} is read, but nothing writes to it.`,
            },
          ];
        return [];
      }),
};

const missingDeadLetter: Rule = {
  id: 'AP-012',
  title: 'No dead-letter handling',
  severity: 'info',
  packs: ['event-driven'],
  rationale:
    'Some messages always fail (bad data, a bug). Without a dead-letter queue they are retried forever or dropped silently. Send them to a dead-letter queue where someone can inspect and replay them.',
  check: ({ graph: g }) =>
    g.elements
      .filter((e) => g.category(e) === 'data-in-motion' && g.incoming(e.id, 'consumes').length > 0)
      .filter((q) => q.properties?.deadLetter !== true)
      .map((q) => ({
        targetIds: [q.id],
        message: `Consumers of ${q.name} have nowhere to put messages that keep failing.`,
        fixes: [
          {
            title: 'Mark: failing messages go to a dead-letter queue',
            ops: [
              {
                op: 'updateElement',
                id: q.id,
                patch: { properties: { ...(q.properties ?? {}), deadLetter: true } },
              },
            ],
          },
        ],
      })),
};

/** Deployables that write a data store and publish messages outside that transaction. */
export function dualWrites(
  g: GraphQuery,
): { deployable: Element; writes: Relation[]; publishes: Relation[] }[] {
  return g.elements
    .filter((e) => g.category(e) === 'deployable')
    .map((d) => ({
      deployable: d,
      writes: g.outgoingFromSubtree(d.id, 'writes'),
      publishes: g.outgoingFromSubtree(d.id, 'publishes').filter((r) => r.inTransaction !== true),
    }))
    .filter((x) => x.writes.length > 0 && x.publishes.length > 0);
}

const dualWrite: Rule = {
  id: 'AP-013',
  title: 'Dual write',
  severity: 'warning',
  packs: ['event-driven'],
  learnId: 'topic.transactions-and-isolation',
  rationale:
    'Writing to the database and then publishing a message are two separate actions. If the process crashes between them, the database and the message disagree. Use a transactional outbox: write the message to an outbox table in the same transaction, and publish it from there.',
  check: ({ graph: g }) =>
    dualWrites(g).map(({ deployable, writes, publishes }) => ({
      targetIds: [deployable.id],
      relatedIds: [...writes, ...publishes].map((r) => r.id),
      message: `${deployable.name} writes data and publishes messages separately. A crash in between leaves them out of sync. Use an outbox.`,
    })),
};

const cacheAsTruth: Rule = {
  id: 'AP-014',
  title: 'Cache used as the source of truth',
  severity: 'warning',
  packs: ['core'],
  rationale:
    'A cache can be emptied at any time. If data is only written to the cache, it is lost on a restart or an eviction. Write to a durable store and use the cache only to speed up reads.',
  check: ({ graph: g }) =>
    g.elements
      .filter((e) => e.properties?.kind === 'cache' || e.tags?.includes('cache'))
      .flatMap((cache) => {
        const writers = g
          .incoming(cache.id, 'writes')
          .map((r) => runner(g, r.sourceId))
          .filter((x): x is Id => !!x);
        const durable = writers.some((w) =>
          g.outgoingFromSubtree(w, 'writes').some((r) => {
            const target = storeRoot(g, r.targetId);
            return target && target.properties?.kind !== 'cache' && !target.tags?.includes('cache');
          }),
        );
        return writers.length > 0 && !durable
          ? [
              {
                targetIds: [cache.id],
                relatedIds: writers,
                message: `${cache.name} is written, but its writers keep the data nowhere else.`,
              },
            ]
          : [];
      }),
};

const sensitiveLeak: Rule = {
  id: 'AP-015',
  title: 'Sensitive data reachable from outside',
  severity: 'error',
  packs: ['security'],
  learnId: 'topic.authentication',
  rationale:
    'Personal or secret data must only be read by your own backend code. A browser app, an actor or an external system that reads it directly bypasses every access check.',
  check: ({ graph: g }) =>
    g.elements
      .filter((e) => g.category(e) === 'data-at-rest')
      .filter((e) =>
        [e, ...g.ancestors(e.id)].some((x) =>
          ['pii', 'secret'].includes(x.qualities?.sensitivity ?? ''),
        ),
      )
      .flatMap((store) =>
        g
          .incoming(store.id, 'reads', 'writes')
          .filter((r) => {
            const from = g.element(r.sourceId)!;
            return (
              ['external', 'actor'].includes(g.category(from) ?? '') ||
              isFrontend(g, g.deployableOf(r.sourceId) ?? from)
            );
          })
          .map((r) => ({
            targetIds: [r.id],
            relatedIds: [store.id, r.sourceId],
            message: `${g.element(r.sourceId)!.name} reads sensitive data in ${store.name} directly.`,
          })),
      ),
};

const disconnected: Rule = {
  id: 'AP-016',
  title: 'Disconnected element',
  severity: 'info',
  packs: ['core'],
  rationale:
    'An element with no relations tells the reader nothing about how it fits in. Connect it, or remove it if it is not part of the design.',
  check: ({ graph: g }) =>
    g.elements
      .filter((e) => !e.parentId && g.category(e) !== 'group')
      .filter((e) =>
        g
          .subtree(e.id)
          .every((x) => g.incoming(x.id).length === 0 && g.outgoing(x.id).length === 0),
      )
      .map((e) => ({ targetIds: [e.id], message: `${e.name} is not connected to anything yet.` })),
};

const callbackToPublisher: Rule = {
  id: 'AP-017',
  title: 'Consumer calls the publisher back synchronously',
  severity: 'warning',
  packs: ['event-driven'],
  rationale:
    'Events decouple the publisher from its consumers. If a consumer then calls the publisher synchronously, the two are coupled again, and the call can arrive while the publisher is still busy with the original request. Publish a reply event instead.',
  check: ({ graph: g }) => {
    const out: RawFinding[] = [];
    const channels = g.elements.filter((e) =>
      ['data-in-motion', 'event'].includes(g.category(e) ?? ''),
    );
    for (const ch of channels) {
      const producers = new Set(
        g
          .incoming(ch.id, 'publishes', 'emits')
          .map((r) => runner(g, r.sourceId))
          .filter((x): x is Id => !!x),
      );
      const consumers = new Set(
        g
          .incoming(ch.id, 'consumes', 'handles')
          .map((r) => runner(g, r.sourceId))
          .filter((x): x is Id => !!x),
      );
      for (const c of consumers) {
        for (const call of g.outgoingFromSubtree(c, 'calls').filter(isSync)) {
          const target = runner(g, call.targetId);
          if (target && target !== c && producers.has(target)) {
            out.push({
              targetIds: [call.id],
              relatedIds: [ch.id, c, target],
              message: `${g.element(c)!.name} consumes ${ch.name} from ${g.element(target)!.name} and then calls ${g.element(target)!.name} back synchronously.`,
            });
          }
        }
      }
    }
    return out;
  },
};

const unlabelledCall: Rule = {
  id: 'AP-018',
  title: 'Call without label or protocol',
  severity: 'info',
  packs: ['core'],
  rationale:
    'A call between two services says more when it names the operation ("POST /orders") or at least the protocol. People and AI agents reading the diagram use it to find the code.',
  check: ({ graph: g }) =>
    g.relations
      .filter(
        (r) =>
          r.type === 'calls' &&
          !r.label &&
          !r.protocol &&
          g.category(g.element(r.sourceId)!) === 'deployable' &&
          g.category(g.element(r.targetId)!) === 'deployable',
      )
      .map((r) => ({
        targetIds: [r.id],
        message: `The call from ${g.element(r.sourceId)!.name} to ${g.element(r.targetId)!.name} has no label or protocol.`,
        fixes: [
          {
            title: 'Mark as HTTP',
            ops: [{ op: 'updateRelation', id: r.id, patch: { protocol: 'http' } }],
          },
        ],
      })),
};

export const GENERIC_RULES: Rule[] = [
  sharedDatabase,
  frontendToDatabase,
  cycles,
  dependencyRule,
  layerSkipping,
  distributedMonolith,
  chattyChain,
  godElement,
  frontendFanOut,
  publicWithoutAuth,
  orphanMessaging,
  missingDeadLetter,
  dualWrite,
  cacheAsTruth,
  sensitiveLeak,
  disconnected,
  callbackToPublisher,
  unlabelledCall,
];
