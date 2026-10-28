import { hasAuth, makeElementId, publicEntries } from '@archguide/core';
import type {
  Element,
  GraphQuery,
  Id,
  ModelOp,
  QuickFix,
  RawFinding,
  Relation,
  Rule,
} from '@archguide/core';

/** Rules of the React + Node.js + PostgreSQL profile (Implementation.md §11.6, §11.7). */

const PROFILE_PACK = 'react-node-postgres';

// --- helpers -----------------------------------------------------------------

const names = (g: GraphQuery, ids: Iterable<Id>) =>
  [...ids].map((id) => g.element(id)?.name ?? id).join(', ');

const name = (g: GraphQuery, id: Id) => g.element(id)?.name ?? id;

const prop = (item: Element | Relation, key: string): unknown => item.properties?.[key];

/** A quick fix that merges properties into an element or relation (patches are shallow). */
function setProps(
  title: string,
  item: Element | Relation,
  what: 'element' | 'relation',
  props: Record<string, unknown>,
): QuickFix {
  const patch = { properties: { ...(item.properties ?? {}), ...props } };
  const op: ModelOp =
    what === 'element'
      ? { op: 'updateElement', id: item.id, patch }
      : { op: 'updateRelation', id: item.id, patch };
  return { title, ops: [op] };
}

/** Node deployables that run request-handling code (not background processes). */
const SERVING = ['node.service', 'node.bff'];

/** Text of the element that keyword rules look at: name, responsibilities and tags. */
const keywords = (el: Element) =>
  [el.name, ...(el.responsibilities ?? []), ...(el.tags ?? [])].join(' ').toLowerCase();

/** Unique deployables that run the sources of these relations. */
function runners(g: GraphQuery, relations: readonly Relation[]): Element[] {
  const map = new Map<Id, Element>();
  for (const r of relations) {
    const d = g.deployableOf(r.sourceId);
    if (d) map.set(d.id, d);
  }
  return [...map.values()];
}

const isMutating = (method: unknown) =>
  method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

/** Code reachable from `start` along synchronous code relations (calls, depends-on, ports). */
function syncReach(g: GraphQuery, start: Id): Element[] {
  const seen = new Set<Id>([start]);
  const queue = [start];
  const result: Element[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const next = [
      ...g
        .outgoing(id, 'calls', 'depends-on', 'uses-port', 'invokes')
        .filter((r) => r.mode !== 'async')
        .map((r) => r.targetId),
      // A port is implemented by adapters; the call continues into them.
      ...(g.is(g.element(id), 'node.port')
        ? g.incoming(id, 'implements').map((r) => r.sourceId)
        : []),
    ];
    for (const n of next) {
      if (seen.has(n)) continue;
      seen.add(n);
      const el = g.element(n);
      if (!el || g.is(el, 'node.worker')) continue;
      result.push(el);
      queue.push(n);
    }
  }
  return result;
}

// --- data ownership ------------------------------------------------------------

/** The unit of data ownership: the schema written, else the topmost store. */
function ownershipUnit(g: GraphQuery, id: Id): Element | undefined {
  const schema = g.nearest(id, 'pg.schema');
  if (schema) return schema;
  const stores = [g.element(id), ...g.ancestors(id)].filter(
    (e): e is Element => !!e && g.category(e) === 'data-at-rest',
  );
  return stores[stores.length - 1];
}

const sharedTables: Rule = {
  id: 'RNP-001',
  title: 'Shared tables between services',
  severity: 'warning',
  packs: ['microservices'],
  replaces: ['AP-001'],
  learnId: 'pg.table',
  rationale:
    'When two services write the same tables, a migration in one can break the other, and neither can be deployed alone. Separate databases, or separate schemas on one Postgres server, are fine. Give each schema one owning service; other services get the data through its API or its events. Background workers of the same service do not count as other writers.',
  invariant:
    'Each PostgreSQL schema MUST have one writing service; other services use its API or events.',
  appliesTo: ['pg.schema', 'pg.database'],
  check: ({ graph: g }) => {
    const byUnit = new Map<Id, Relation[]>();
    for (const r of g.relations.filter((r) => g.typeIs(r, 'writes'))) {
      const unit = ownershipUnit(g, r.targetId);
      if (!unit) continue;
      byUnit.set(unit.id, [...(byUnit.get(unit.id) ?? []), r]);
    }
    return [...byUnit].flatMap(([unitId, writes]) => {
      const writers = runners(g, writes).filter(
        (d) => !g.is(d, 'node.worker') && !g.is(d, 'node.scheduler'),
      );
      if (writers.length < 2) return [];
      return [
        {
          targetIds: [unitId],
          relatedIds: [...writers.map((d) => d.id), ...writes.map((r) => r.id)],
          message: `${name(g, unitId)} is written by ${names(
            g,
            writers.map((d) => d.id),
          )}. Pick one owner; the others read through its API or events.`,
        },
      ];
    });
  },
};

const migrationOwners: Rule = {
  id: 'RNP-002',
  title: 'Several migration owners',
  severity: 'error',
  packs: [PROFILE_PACK],
  learnId: 'pg.table',
  rationale:
    "Migrations change the shape of tables. When two codebases run migrations on the same schema, they overwrite each other's changes and the order of deploys decides what the database looks like. Pick one owner per schema; others read through a view or an API.",
  invariant: 'Each schema MUST have exactly one migration owner.',
  appliesTo: ['pg.schema', 'pg.database'],
  check: ({ graph: g }) =>
    g.ofKind('pg.schema', 'pg.database').flatMap((target) => {
      // Migrations of the database also change every schema in it.
      const db = g.is(target, 'pg.schema') ? g.nearest(target.id, 'pg.database') : undefined;
      const migrations = [
        ...g.incoming(target.id, 'migrates'),
        ...(db ? g.incoming(db.id, 'migrates') : []),
      ];
      const owners = new Set(migrations.map((r) => g.deployableOf(r.sourceId)?.id ?? r.sourceId));
      if (owners.size < 2) return [];
      // Report a conflict that is only on the database once, on the database.
      if (db && g.incoming(target.id, 'migrates').length === 0) return [];
      return [
        {
          targetIds: [target.id],
          relatedIds: [...owners, ...migrations.map((r) => r.id)],
          message: `${target.name} is migrated by ${names(g, owners)}. Only one of them may change its tables.`,
        },
      ];
    }),
};

// --- layers and the domain -------------------------------------------------------

const handlerUsesOrm: Rule = {
  id: 'RNP-005',
  title: 'Route handler uses the database directly',
  severity: 'warning',
  packs: ['layered', 'hexagonal'],
  learnId: 'topic.models',
  rationale:
    'A route handler should turn HTTP into a call and back. When it also runs queries, business rules end up in controllers, are copied between endpoints, and cannot be tested without HTTP. Put a use case and a repository between the handler and Postgres.',
  invariant:
    'Route handlers MUST NOT query PostgreSQL directly; they call a use case, which uses a repository.',
  appliesTo: ['node.route-handler'],
  check: ({ graph: g }) =>
    g.ofKind('node.route-handler').flatMap((h) =>
      g
        .outgoingFromSubtree(h.id, 'reads', 'writes')
        .filter((r) => g.is(g.element(r.targetId), 'pg.*'))
        .map((r) => ({
          targetIds: [r.id],
          relatedIds: [h.id, r.targetId],
          message: `${h.name} ${r.type} ${name(g, r.targetId)} directly. Call a use case, and let a repository run the query.`,
        })),
    ),
};

const domainOnInfrastructure: Rule = {
  id: 'RNP-006',
  title: 'Domain depends on the database or framework',
  severity: 'warning',
  packs: ['hexagonal'],
  replaces: ['AP-004'],
  learnId: 'topic.models',
  rationale:
    'The domain holds the business rules. If it imports the ORM, a repository class or HTTP code, every infrastructure change touches the rules, and the rules cannot be tested alone. Let the domain depend on a port (an interface) that a repository implements.',
  invariant: 'Domain code MUST NOT import the ORM, repositories or HTTP code; it depends on ports.',
  appliesTo: ['node.domain'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'depends-on', 'calls', 'reads', 'writes'))
      .filter(
        (r) => g.is(g.element(r.sourceId), 'node.domain') || g.layerOf(r.sourceId) === 'domain',
      )
      .filter((r) => {
        const target = g.element(r.targetId);
        return (
          g.is(target, 'node.repository') ||
          g.is(target, 'pg.*') ||
          g.is(target, 'node.route-handler') ||
          g.is(target, 'node.middleware') ||
          ['infrastructure', 'presentation', 'data'].includes(g.layerOf(r.targetId) ?? '')
        );
      })
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} (domain) depends on ${name(g, r.targetId)}. Depend on a port instead, and let the repository or adapter implement it.`,
      })),
};

// --- events and jobs -------------------------------------------------------------

const dualWrite: Rule = {
  id: 'RNP-007',
  title: 'Dual write',
  severity: 'warning',
  packs: ['event-driven'],
  replaces: ['AP-013'],
  learnId: 'topic.transactions-and-isolation',
  rationale:
    'Writing to Postgres and then publishing a message are two separate actions. If the process crashes between them, the data and the message disagree. With a Postgres job queue (pg-boss, graphile-worker) add the job in the same transaction as the data. With another broker, write the message to an outbox table in the transaction and publish it from there. NOTIFY is sent on commit, so it is not a dual write.',
  invariant:
    'Jobs MUST be enqueued in the same transaction as their data; messages to other brokers go through an outbox.',
  appliesTo: ['category:data-in-motion'],
  check: ({ graph: g }) =>
    g.elements
      .filter((d) => g.category(d) === 'deployable')
      .flatMap((d) => {
        const writes = g.outgoingFromSubtree(d.id, 'writes');
        if (writes.length === 0) return [];
        const hasOutbox = writes.some((r) => /outbox/i.test(name(g, r.targetId)));
        const publishes = g
          .outgoingFromSubtree(d.id, 'publishes')
          .filter((r) => r.inTransaction !== true)
          .filter((r) => !hasOutbox || g.typeIs(r, 'enqueues'));
        if (publishes.length === 0) return [];
        const enqueues = publishes.filter((r) => g.typeIs(r, 'enqueues'));
        return [
          {
            targetIds: [d.id],
            relatedIds: [...writes, ...publishes].map((r) => r.id),
            message: `${d.name} writes data and sends messages to ${names(g, new Set(publishes.map((r) => r.targetId)))} outside the transaction. A crash in between leaves them out of sync.`,
            fixes:
              enqueues.length > 0
                ? [
                    {
                      title: 'Enqueue jobs in the same transaction as the data',
                      ops: enqueues.map((r): ModelOp => ({
                        op: 'updateRelation',
                        id: r.id,
                        patch: { inTransaction: true },
                      })),
                    },
                  ]
                : [],
          },
        ];
      }),
};

const SLOW = /export|report|batch|import|email|pdf|video|transcode/i;

const slowRequestPath: Rule = {
  id: 'RNP-008',
  title: 'Slow work in the request path',
  severity: 'info',
  packs: ['concurrency'],
  learnId: 'topic.event-loop-and-parallelism',
  rationale:
    'Users wait while a request runs. Reports, exports, imports and e-mails can take seconds or minutes, hit timeouts, and hold a database connection the whole time. Enqueue a job, answer at once (202 Accepted), and let a worker do the work.',
  check: ({ graph: g }) =>
    g.ofKind('node.route-handler').flatMap((h) => {
      if (g.outgoingFromSubtree(h.id, 'publishes').length > 0) return [];
      const slow = [h, ...syncReach(g, h.id)].filter(
        (e) =>
          (e.qualities?.slow === true || SLOW.test(keywords(e))) &&
          g.outgoingFromSubtree(e.id, 'publishes').length === 0,
      );
      if (slow.length === 0) return [];
      return [
        {
          targetIds: [h.id],
          relatedIds: slow.map((e) => e.id),
          message: `Requests to ${h.name} wait for slow work (${names(
            g,
            slow.map((e) => e.id),
          )}). Enqueue a job and let a worker do it.`,
        },
      ];
    }),
};

/** Elements inside a deployable that touch Postgres. */
const usesPostgres = (g: GraphQuery, d: Element) =>
  g
    .outgoingFromSubtree(d.id, 'reads', 'writes', 'connects-via', 'listens', 'processes')
    .some((r) => g.is(g.element(r.targetId), 'pg.*'));

const connectsViaPooler = (g: GraphQuery, d: Element) =>
  g.outgoingFromSubtree(d.id, 'connects-via').some((r) => g.is(g.element(r.targetId), 'pg.pooler'));

const noPooling: Rule = {
  id: 'RNP-009',
  title: 'No connection pooler at scale',
  severity: 'warning',
  packs: ['concurrency'],
  learnId: 'topic.event-loop-and-parallelism',
  rationale:
    'Every instance of a service opens its own pool of Postgres connections. With many instances, or serverless functions that start and stop all the time, Postgres runs out of connections. Put a pooler (PgBouncer in transaction mode, or a managed pooler) between the service and the database.',
  invariant:
    'Horizontally scaled or serverless services MUST connect to PostgreSQL through a connection pooler.',
  appliesTo: ['node.service', 'node.bff'],
  check: ({ graph: g }) =>
    g
      .ofKind(...SERVING)
      .filter((d) => d.qualities?.scaling === 'horizontal' || d.qualities?.scaling === 'serverless')
      .filter((d) => usesPostgres(g, d) && !connectsViaPooler(g, d))
      .map((d) => ({
        targetIds: [d.id],
        message: `${d.name} scales ${d.qualities!.scaling === 'serverless' ? 'as serverless functions' : 'to many instances'}, and each one opens its own connections. Connect through a pooler.`,
      })),
};

const notifyForDurableWork: Rule = {
  id: 'RNP-010',
  title: 'NOTIFY used for durable work',
  severity: 'info',
  packs: ['event-driven'],
  learnId: 'pg.function',
  rationale:
    'LISTEN/NOTIFY only reaches listeners that are connected at that moment. If the worker is restarting, the notification is lost and the work is never done. Use NOTIFY to wake things up, and a job queue (pg-boss, graphile-worker) for work that must happen.',
  invariant: 'Work that must happen MUST go through a job queue, not LISTEN/NOTIFY.',
  appliesTo: ['pg.channel'],
  check: ({ graph: g }) =>
    g.ofKind('pg.channel').flatMap((ch) => {
      const workers = g
        .incoming(ch.id, 'listens')
        .filter((r) => g.is(g.deployableOf(r.sourceId), 'node.worker'));
      if (workers.length === 0) return [];
      return [
        {
          targetIds: [ch.id],
          relatedIds: workers.flatMap((r) => [r.id, r.sourceId]),
          message: `${names(g, new Set(workers.map((r) => g.deployableOf(r.sourceId)!.id)))} do work on notifications from ${ch.name}. Notifications sent while a worker is down are lost; use a job queue.`,
        },
      ];
    }),
};

// --- frontend --------------------------------------------------------------------

const frontendFanOut: Rule = {
  id: 'RNP-011',
  title: 'React app calls many services',
  severity: 'warning',
  packs: ['microservices'],
  replaces: ['AP-009'],
  rationale:
    'When the React app calls many Node services directly, it has to know all of them, make many requests per page, and handle each partial failure. Add a Node backend-for-frontend that combines the calls for the app.',
  invariant: (s) =>
    `The React app MUST call at most ${s.thresholds.frontendDirectServices} Node services directly; use a BFF beyond that.`,
  appliesTo: ['react.app'],
  check: ({ graph: g, settings }) =>
    g.ofKind('react.app').flatMap((app) => {
      const services = new Set(
        g
          .outgoingFromSubtree(app.id, 'calls')
          .map((r) => g.deployableOf(r.targetId))
          .filter((d): d is Element => !!d && g.is(d, 'node.*'))
          .map((d) => d.id),
      );
      if (services.size <= settings.thresholds.frontendDirectServices) return [];
      return [
        {
          targetIds: [app.id],
          relatedIds: [...services],
          message: `${app.name} calls ${services.size} Node services directly (${names(g, services)}). Add a backend-for-frontend.`,
        },
      ];
    }),
};

const FSD_ORDER = ['shared', 'entities', 'features', 'widgets', 'pages', 'app'];
const fsdLayer = (el: Element) => {
  const v = prop(el, 'fsdLayer');
  return typeof v === 'string' ? FSD_ORDER.indexOf(v) : -1;
};

const fsdDirection: Rule = {
  id: 'RNP-013',
  title: 'Feature-Sliced Design layer direction',
  severity: 'warning',
  packs: ['fsd'],
  rationale:
    'In Feature-Sliced Design a layer only imports layers below it: app → pages → widgets → features → entities → shared. An import upwards creates hidden cycles. Move the shared code down, or pass it in through props or slots.',
  invariant: 'Feature-Sliced code MUST only import from layers below its own.',
  appliesTo: ['react.feature'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'depends-on'))
      .filter((r) => {
        const [a, b] = [g.element(r.sourceId)!, g.element(r.targetId)!];
        return fsdLayer(a) >= 0 && fsdLayer(b) > fsdLayer(a);
      })
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} (${String(prop(g.element(r.sourceId)!, 'fsdLayer'))}) imports ${name(g, r.targetId)} (${String(prop(g.element(r.targetId)!, 'fsdLayer'))}), a higher layer.`,
      })),
};

const featureToFeature: Rule = {
  id: 'RNP-014',
  title: 'Feature imports another feature',
  severity: 'warning',
  packs: ['fsd'],
  rationale:
    'Features that import each other cannot be changed or removed alone. Move the shared part down to an entity or to shared code, or compose the features in a page or widget.',
  invariant: 'Features MUST NOT import other features.',
  appliesTo: ['react.feature'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'depends-on') && r.sourceId !== r.targetId)
      .filter((r) => {
        const [a, b] = [g.element(r.sourceId)!, g.element(r.targetId)!];
        if (!g.is(a, 'react.feature') || !g.is(b, 'react.feature')) return false;
        const layer = fsdLayer(a);
        // Slices of one layer must not import each other; "shared" and "app" have no slices.
        return layer === fsdLayer(b) && layer !== 0 && layer !== FSD_ORDER.indexOf('app');
      })
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} imports ${name(g, r.targetId)}. Move what they share to an entity or to shared code.`,
      })),
};

// --- API design ------------------------------------------------------------------

const noValidation: Rule = {
  id: 'RNP-015',
  title: 'No validation at the boundary',
  severity: 'info',
  packs: ['api'],
  learnId: 'node.endpoint',
  rationale:
    'Data from the network can be anything. TypeScript types disappear at run time, so a handler that trusts its input crashes, or writes bad data. Validate every request with a schema (zod, TypeBox, class-validator); share the schema with the frontend through a contract.',
  invariant: 'Route handlers MUST validate every request with a schema (zod or similar).',
  appliesTo: ['node.route-handler'],
  check: ({ graph: g }) =>
    g
      .ofKind('node.route-handler')
      .filter((h) => {
        const v = prop(h, 'validation');
        return v === undefined || v === 'none';
      })
      .filter((h) => {
        const d = g.deployableOf(h.id);
        return !(
          d &&
          g
            .subtree(d.id)
            .some((e) => g.is(e, 'node.middleware') && prop(e, 'kind') === 'validation')
        );
      })
      .filter(
        (h) =>
          g.incomingToSubtree(h.id, 'calls').length > 0 ||
          g.subtree(h.id).some((e) => g.is(e, 'node.endpoint') && isMutating(prop(e, 'method'))),
      )
      .map((h) => ({
        targetIds: [h.id],
        message: `${h.name} does not say how it validates requests.`,
        fixes: [setProps('Validate requests with zod', h, 'element', { validation: 'zod' })],
      })),
};

const publicWithoutAuth: Rule = {
  id: 'RNP-016',
  title: 'Public service without authentication',
  severity: 'warning',
  packs: ['security'],
  replaces: ['AP-010'],
  learnId: 'topic.authentication',
  rationale:
    'Anything the browser can reach, anyone on the internet can reach. Show how the service checks who is calling: an auth middleware, a gateway that checks tokens, or a link to an auth provider. If an endpoint is public on purpose, mark it with `auth: none` and suppress the finding with a reason.',
  invariant:
    'Services reachable from the browser MUST authenticate callers (auth middleware, gateway or auth provider).',
  appliesTo: ['node.service', 'node.bff'],
  check: ({ graph: g }) =>
    publicEntries(g)
      .filter((e) => !hasAuth(g, e))
      .filter((e) => {
        // Every endpoint states its auth: the model shows how calls are checked.
        const endpoints = g.subtree(e.id).filter((x) => g.is(x, 'node.endpoint'));
        return endpoints.length === 0 || endpoints.some((x) => prop(x, 'auth') === undefined);
      })
      .map((e) => {
        const fixes: QuickFix[] = [];
        if (g.is(e, 'node.service') || g.is(e, 'node.bff')) {
          const taken = new Set(g.elements.map((x) => x.id));
          fixes.push({
            title: 'Add an auth middleware',
            ops: [
              {
                op: 'addElement',
                element: {
                  id: makeElementId('mw', `${e.name} auth`, taken),
                  kind: 'node.middleware',
                  name: 'Auth middleware',
                  status: 'planned',
                  parentId: e.id,
                  properties: { kind: 'auth' },
                },
              },
            ],
          });
        }
        return {
          targetIds: [e.id],
          message: `${e.name} is reachable from the browser, and the model shows no authentication. Add an auth middleware, or connect it to an auth provider.`,
          fixes,
        };
      }),
};

// --- concurrency -----------------------------------------------------------------

const CONTENDED = /stock|inventory|balance|seat|counter|quota|wallet|booking/i;

/** How many copies of this code can run at the same time. */
function parallelism(g: GraphQuery, id: Id): number {
  const d = g.deployableOf(id);
  if (!d) return 1;
  const instances =
    d.qualities?.scaling === 'horizontal' || d.qualities?.scaling === 'serverless'
      ? Math.max(2, g.num(d, 'instances', 2))
      : g.num(d, 'instances', 1);
  return instances * (g.is(d, 'node.worker') ? g.num(d, 'concurrency', 1) : 1);
}

const lostUpdate: Rule = {
  id: 'RNP-019',
  title: 'Lost-update risk',
  severity: 'warning',
  packs: ['concurrency'],
  learnId: 'topic.concurrency-control',
  rationale:
    'Two requests read the same row, both change it, and the second write silently replaces the first: one sale of the last item is lost, or a balance is wrong. When several writers can change the same rows, lock the row (`SELECT … FOR UPDATE`), or check a version column in the `UPDATE`.',
  invariant:
    'Writes to rows that several writers change MUST use a row lock or an optimistic version check.',
  appliesTo: ['pg.table', 'pg.schema'],
  check: ({ graph: g }) => {
    const out: RawFinding[] = [];
    for (const r of g.relations.filter((r) => g.typeIs(r, 'writes'))) {
      const control = prop(r, 'concurrencyControl');
      if (control !== undefined && control !== 'none') continue;
      const target = g.element(r.targetId)!;
      const writers = g.incoming(target.id, 'writes');
      const concurrent = writers.reduce((sum, w) => sum + parallelism(g, w.sourceId), 0) > 1;
      const contended =
        target.tags?.includes('contended') === true ||
        (concurrent && CONTENDED.test(`${keywords(target)} ${keywords(g.element(r.sourceId)!)}`));
      if (!contended) continue;
      out.push({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} writes ${target.name}, which several writers can change at the same time, without concurrency control. Updates can be lost.`,
        fixes: [
          setProps('Lock the row (SELECT … FOR UPDATE)', r, 'relation', {
            concurrencyControl: 'row-lock',
          }),
          setProps('Check a version column (optimistic)', r, 'relation', {
            concurrencyControl: 'optimistic-version',
          }),
        ],
      });
    }
    return out;
  },
};

const DEFAULT_POOL = 10;
const DEFAULT_MAX_CONNECTIONS = 100;

const connectionExhaustion: Rule = {
  id: 'RNP-020',
  title: 'Connection exhaustion',
  severity: 'warning',
  packs: ['concurrency'],
  learnId: 'topic.event-loop-and-parallelism',
  rationale:
    'Each instance of each service keeps its own pool of connections. Add them up: when the total gets close to `max_connections`, new connections fail under load, and deploys (old and new instances at once) fail first. Use smaller pools, or put PgBouncer in transaction mode in front of the database.',
  invariant:
    'The connection pools of all services together MUST stay below 80% of max_connections, or go through a pooler.',
  appliesTo: ['pg.database'],
  check: ({ graph: g }) =>
    g.ofKind('pg.database').flatMap((db) => {
      const pooled = g
        .incomingToSubtree(db.id, 'connects-via')
        .some((r) => g.is(g.element(r.sourceId), 'pg.pooler'));
      if (pooled) return [];
      const users = runners(
        g,
        g.incomingToSubtree(db.id, 'reads', 'writes', 'processes', 'listens'),
      );
      const total = users.reduce(
        (sum, d) => sum + g.num(d, 'instances', 1) * g.num(d, 'poolSize', DEFAULT_POOL),
        0,
      );
      const max = g.num(db, 'maxConnections', DEFAULT_MAX_CONNECTIONS);
      if (total <= max * 0.8) return [];
      const parts = users
        .map((d) => `${d.name} ${g.num(d, 'instances', 1)} × ${g.num(d, 'poolSize', DEFAULT_POOL)}`)
        .join(', ');
      return [
        {
          targetIds: [db.id],
          relatedIds: users.map((d) => d.id),
          message: `Up to ${total} connections (${parts}) for ${db.name}, which allows ${max}. Use smaller pools or add a pooler.`,
        },
      ];
    }),
};

const CPU_HEAVY = /resiz|image|pdf|hash|encrypt|compress|thumbnail|report|parse large/i;

const cpuOnEventLoop: Rule = {
  id: 'RNP-021',
  title: 'CPU-heavy work on the event loop',
  severity: 'info',
  packs: ['concurrency'],
  learnId: 'topic.event-loop-and-parallelism',
  rationale:
    'Node runs your JavaScript on one thread. While it resizes an image or builds a PDF, no other request of that process is answered. More processes (cluster) do not help the requests stuck behind it. Move the work to `worker_threads`, or to a background worker.',
  invariant:
    'CPU-heavy work MUST NOT run on the event loop of a request-serving process; use worker threads or a worker.',
  appliesTo: ['node.service', 'node.bff'],
  check: ({ graph: g }) =>
    g.elements
      .filter(
        (e) => g.is(e, 'node.*') && (e.tags?.includes('cpu-heavy') || CPU_HEAVY.test(keywords(e))),
      )
      .filter((e) => {
        const d = g.deployableOf(e.id);
        return (
          !!d && SERVING.some((k) => g.is(d, k)) && prop(d, 'processModel') !== 'worker-threads'
        );
      })
      .filter((e) => g.outgoingFromSubtree(e.id, 'publishes').length === 0)
      // Report the innermost element only.
      .filter((e, _, all) => !all.some((o) => o !== e && g.ancestors(o.id).includes(e)))
      .map((e) => ({
        targetIds: [e.id],
        message: `${e.name} looks CPU-heavy and runs on the event loop of ${g.deployableOf(e.id)!.name}. Other requests wait while it runs.`,
      })),
};

const serializableWithoutRetry: Rule = {
  id: 'RNP-022',
  title: 'Serializable without retry',
  severity: 'info',
  packs: ['concurrency'],
  learnId: 'topic.transactions-and-isolation',
  rationale:
    'Postgres keeps serializable transactions correct by aborting one of two that conflict, with SQLSTATE 40001. That is expected, not a bug: the application must run the whole transaction again. Without a retry loop, users see random errors under load.',
  invariant: 'Serializable transactions MUST be retried on SQLSTATE 40001.',
  appliesTo: ['pg.schema', 'pg.database', 'pg.table'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'writes') && prop(r, 'isolation') === 'serializable')
      .filter((r) => prop(r, 'concurrencyControl') !== 'serializable-retry')
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} writes ${name(g, r.targetId)} in serializable transactions without retrying them on serialization failures.`,
        fixes: [
          setProps('Retry the transaction on SQLSTATE 40001', r, 'relation', {
            concurrencyControl: 'serializable-retry',
          }),
        ],
      })),
};

const retriedNotIdempotent: Rule = {
  id: 'RNP-023',
  title: 'Retried call is not idempotent',
  severity: 'warning',
  packs: ['api', 'concurrency'],
  learnId: 'node.endpoint',
  rationale:
    'A timeout does not tell you whether the server did the work. When the client retries a POST, the order may be created twice, or the card charged twice. Send an `Idempotency-Key` header and store it with a unique constraint, so a repeated request returns the first result.',
  invariant:
    'Retried POST and PATCH calls MUST send an Idempotency-Key that the server stores with a unique constraint.',
  appliesTo: ['node.endpoint'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'calls') && Number(prop(r, 'retries') ?? 0) > 0)
      .filter((r) => prop(r, 'idempotencyKey') !== true && prop(r, 'idempotent') !== true)
      .filter((r) => {
        const t = g.element(r.targetId)!;
        const method = prop(t, 'method');
        return (
          g.is(t, 'node.endpoint') &&
          (method === 'POST' || method === 'PATCH') &&
          prop(t, 'idempotent') !== true
        );
      })
      .map((r) => ({
        targetIds: [r.id],
        relatedIds: [r.sourceId, r.targetId],
        message: `${name(g, r.sourceId)} retries ${name(g, r.targetId)}, which is not idempotent. A retry after a timeout can do the work twice.`,
        fixes: [setProps('Send an Idempotency-Key', r, 'relation', { idempotencyKey: true })],
      })),
};

/** Whether users can reach the endpoint: called by an actor or browser code, or in a public service. */
function reachable(g: GraphQuery, endpoint: Element, entries: ReadonlySet<Id>): boolean {
  const fromOutside = g.incoming(endpoint.id, 'calls').some((r) => {
    const src = g.element(r.sourceId)!;
    return g.category(src) === 'actor' || g.is(g.deployableOf(src.id) ?? src, 'react.*');
  });
  const d = g.deployableOf(endpoint.id);
  return fromOutside || (!!d && entries.has(d.id));
}

const mutatingWithoutAuth: Rule = {
  id: 'RNP-024',
  title: 'Mutating endpoint without authentication',
  severity: 'warning',
  packs: ['security'],
  learnId: 'topic.authentication',
  rationale:
    'An endpoint that changes data and does not check who is calling lets anyone change that data. Require authentication. If it must be public (a sign-up or a webhook), suppress the finding and write down how it is protected (rate limit, signature, CAPTCHA).',
  invariant:
    'Endpoints that change data MUST require authentication, unless a suppression documents why not.',
  appliesTo: ['node.endpoint'],
  check: ({ graph: g }) => {
    const entries = new Set(publicEntries(g).map((e) => e.id));
    return g
      .ofKind('node.endpoint')
      .filter((e) => isMutating(prop(e, 'method')) && prop(e, 'auth') === 'none')
      .filter((e) => reachable(g, e, entries))
      .map((e) => ({
        targetIds: [e.id],
        message: `${String(prop(e, 'method'))} ${String(prop(e, 'path') ?? e.name)} changes data and anyone can call it.`,
        fixes: [setProps('Require authentication', e, 'element', { auth: 'required' })],
      }));
  },
};

const unpaginatedList: Rule = {
  id: 'RNP-025',
  title: 'Unpaginated list endpoint',
  severity: 'info',
  packs: ['api'],
  learnId: 'node.endpoint',
  rationale:
    'A list that returns every row is fast with test data and slow, or out of memory, in production. Return pages: cursor pagination (`?after=<id>&limit=50`) stays fast on large tables; offset pagination is simpler but slows down on deep pages.',
  invariant: 'Endpoints that return lists MUST paginate.',
  appliesTo: ['node.endpoint'],
  check: ({ graph: g }) =>
    g
      .ofKind('node.endpoint')
      .filter((e) => prop(e, 'method') === 'GET' && prop(e, 'returnsList') === true)
      .filter((e) => (prop(e, 'pagination') ?? 'none') === 'none')
      .map((e) => ({
        targetIds: [e.id],
        message: `${String(prop(e, 'path') ?? e.name)} returns a list without pagination.`,
        fixes: [setProps('Use cursor pagination', e, 'element', { pagination: 'cursor' })],
      })),
};

const serverDataInClientStore: Rule = {
  id: 'RNP-012',
  title: 'Server data in the client store',
  severity: 'info',
  packs: [PROFILE_PACK],
  learnId: 'react.server-state',
  rationale:
    'A thunk that loads data from the API and puts it in a Redux or Zustand store must handle loading flags, errors, caching, refetching and stale data by hand. A server-state cache (TanStack Query, RTK Query) does all of that. Keep the client store for state the server does not own: the cart before checkout, filters, UI flags.',
  invariant:
    'Data loaded from the API SHOULD live in the server-state cache, not in the client store.',
  appliesTo: ['react.action', 'react.client-store'],
  // Only when the app already has a server-state cache: then there is a better place.
  check: ({ graph: g }) =>
    g.ofKind('react.server-state').length === 0
      ? []
      : g.ofKind('react.action').flatMap((a) => {
          const fetches = g.outgoing(a.id, 'fetches-via');
          const stores = g
            .outgoing(a.id, 'updates')
            .filter((r) => g.element(r.targetId)?.kind === 'react.client-store');
          if (fetches.length === 0 || stores.length === 0) return [];
          return [
            {
              targetIds: [a.id],
              relatedIds: [...fetches, ...stores].map((r) => r.id),
              message: `${a.name} loads data from the API into ${name(g, stores[0]!.targetId)}. The app has a server-state cache: let it hold server data.`,
            },
          ];
        }),
};

const tokensInWebStorage: Rule = {
  id: 'RNP-026',
  title: 'Tokens in web storage',
  severity: 'warning',
  packs: ['security'],
  learnId: 'topic.authentication',
  rationale:
    'Any script on the page can read `localStorage` and `sessionStorage`, so one XSS bug, or one bad npm package, leaks every token. Keep tokens in an HttpOnly, Secure, SameSite cookie, or let a backend-for-frontend hold them.',
  invariant: 'Auth tokens MUST NOT be stored in localStorage or sessionStorage.',
  appliesTo: ['react.app', 'react.client-store'],
  check: ({ graph: g }) => [
    ...g
      .ofKind('react.app')
      .filter((a) => ['local-storage', 'session-storage'].includes(String(prop(a, 'tokenStorage'))))
      .map((a) => ({
        targetIds: [a.id],
        message: `${a.name} keeps auth tokens in ${String(prop(a, 'tokenStorage'))}, where any script on the page can read them.`,
        fixes: [
          setProps('Use an HttpOnly cookie', a, 'element', { tokenStorage: 'http-only-cookie' }),
        ],
      })),
    ...g
      .ofKind('react.client-store')
      .filter((s) => (prop(s, 'persist') ?? 'none') !== 'none')
      .filter((s) => s.tags?.includes('auth') || /auth|token|session/i.test(keywords(s)))
      .map((s) => ({
        targetIds: [s.id],
        message: `${s.name} holds auth data and is persisted to ${String(prop(s, 'persist'))}, where any script on the page can read it.`,
        fixes: [setProps('Do not persist this store', s, 'element', { persist: 'none' })],
      })),
  ],
};

const logicSplit: Rule = {
  id: 'RNP-027',
  title: 'Logic split between SQL and a service',
  severity: 'info',
  packs: [PROFILE_PACK],
  learnId: 'pg.function',
  rationale:
    'When a function or trigger and a Node service both write the same table, the rules for that data live in two places, in two languages. Either can be right; decide where each rule lives and record it in a decision, so the next person knows where to look.',
  check: ({ graph: g, project }) => {
    const documented = new Set(project.decisions.flatMap((d) => d.linkedIds));
    return g.ofKind('pg.table').flatMap((t) => {
      const writes = g.incoming(t.id, 'writes');
      const sql = writes.filter((r) => g.is(g.element(r.sourceId), 'pg.*'));
      const node = writes.filter((r) => g.is(g.element(r.sourceId), 'node.*'));
      if (sql.length === 0 || node.length === 0) return [];
      const involved = [t.id, ...sql.map((r) => r.sourceId)];
      if (involved.some((id) => documented.has(id))) return [];
      return [
        {
          targetIds: [t.id],
          relatedIds: [...sql, ...node].flatMap((r) => [r.id, r.sourceId]),
          message: `${t.name} is written by database code (${names(g, new Set(sql.map((r) => r.sourceId)))}) and by Node code (${names(g, new Set(node.map((r) => r.sourceId)))}). Record which rules live where.`,
        },
      ];
    });
  },
};

const crossModuleWrite: Rule = {
  id: 'RNP-028',
  title: "Module writes another module's schema",
  severity: 'warning',
  packs: ['modular-monolith'],
  learnId: 'pattern.modular-monolith',
  rationale:
    "In a modular monolith each module owns its tables. When one module writes another module's schema, the two can no longer change, test or move into a service on their own. Call the owning module's public service instead. The owner is the schema's `ownedBy` property (module name or ID).",
  invariant:
    'A module MUST only write its own schema; it uses other modules through their public services.',
  appliesTo: ['node.module'],
  check: ({ graph: g }) =>
    g.relations
      .filter((r) => g.typeIs(r, 'writes'))
      .flatMap((r) => {
        const mod = g.nearest(r.sourceId, 'node.module');
        const schema = g.nearest(r.targetId, 'pg.schema');
        const owner = schema && prop(schema, 'ownedBy');
        if (!mod || !schema || typeof owner !== 'string' || !owner) return [];
        if (owner === mod.id || owner.toLowerCase() === mod.name.toLowerCase()) return [];
        return [
          {
            targetIds: [r.id],
            relatedIds: [mod.id, schema.id],
            message: `${mod.name} writes ${schema.name}, which belongs to ${owner}. Call ${owner}'s public service instead.`,
          },
        ];
      }),
};

export const RULES: Rule[] = [
  sharedTables,
  migrationOwners,
  handlerUsesOrm,
  domainOnInfrastructure,
  dualWrite,
  slowRequestPath,
  noPooling,
  notifyForDurableWork,
  frontendFanOut,
  fsdDirection,
  featureToFeature,
  noValidation,
  publicWithoutAuth,
  lostUpdate,
  connectionExhaustion,
  cpuOnEventLoop,
  serializableWithoutRetry,
  retriedNotIdempotent,
  mutatingWithoutAuth,
  unpaginatedList,
  serverDataInClientStore,
  tokensInWebStorage,
  logicSplit,
  crossModuleWrite,
];
