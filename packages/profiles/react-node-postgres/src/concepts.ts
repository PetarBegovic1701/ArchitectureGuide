import { z } from 'zod';
import type { Concept } from '@archguide/core';

const TOP_OR_GROUP = ['top', 'group.*'];
const NODE_DEPLOYABLES = ['node.service', 'node.bff', 'node.worker'];
/** Places for code-level Node elements: inside a deployable, a module, or a layer group. */
const NODE_CODE_PARENTS = ['node.service', 'node.bff', 'node.worker', 'node.module', 'group.layer'];

const dataAccess = z.enum(['prisma', 'drizzle', 'typeorm', 'kysely', 'knex', 'pg']);
const framework = z.enum(['express', 'fastify', 'nestjs']);
const transport = z.enum(['rest', 'graphql', 'trpc', 'websocket']);
/** How many processes run and how each uses CPU cores (learning topic: parallelism). */
const scalingProps = {
  instances: z.number().int().positive(),
  processModel: z.enum(['single', 'cluster', 'worker-threads']),
  /** Database connections per instance. */
  poolSize: z.number().int().positive(),
};
const nodeServiceProps = z
  .object({
    framework,
    runtime: z.string(),
    transport: z.array(transport),
    dataAccess,
    ...scalingProps,
  })
  .partial();

/** React concepts (Implementation.md §9.5). */
const REACT: Concept[] = [
  {
    id: 'react.app',
    name: 'React app',
    category: 'deployable',
    icon: 'atom',
    idPrefix: 'app',
    defaultLayer: 'presentation',
    allowedParents: TOP_OR_GROUP,
    nestingHint:
      'A React app is a top-level element. To have a Node service host its build, use the "serves" relation.',
    propertySchema: z
      .object({
        bundler: z.enum(['vite']),
        router: z.enum(['react-router', 'tanstack-router']),
        rendering: z.enum(['csr']),
        /** Where the browser keeps auth tokens (learning topic: authentication). */
        tokenStorage: z.enum(['http-only-cookie', 'memory', 'local-storage', 'session-storage']),
      })
      .partial(),
    palette: { group: 'Frontend', order: 10, basic: true },
    docs: 'A React single-page app built with Vite. It runs in the browser.',
    aliases: ['spa', 'vite', 'frontend', 'web app'],
  },
  {
    id: 'react.route',
    name: 'Route / page',
    category: 'ui',
    icon: 'app-window',
    idPrefix: 'route',
    allowedParents: ['react.app', 'react.layout'],
    nestingHint: 'Routes live inside a React app or a layout route.',
    propertySchema: z
      .object({ path: z.string(), lazy: z.boolean(), authRequired: z.boolean() })
      .partial(),
    palette: { group: 'Frontend', order: 20, basic: true },
    docs: 'A page reachable by URL (React Router or TanStack Router route).',
    aliases: ['page', 'screen', 'url'],
  },
  {
    id: 'react.layout',
    name: 'Layout route',
    category: 'ui',
    icon: 'layout-template',
    idPrefix: 'layout',
    allowedParents: ['react.app', 'react.layout'],
    nestingHint: 'Layout routes live inside a React app or another layout route.',
    propertySchema: z.object({ path: z.string() }).partial(),
    palette: { group: 'Frontend', order: 30, basic: false },
    docs: 'A route that renders shared UI (header, sidebar) around its child routes.',
    aliases: ['shell', 'outlet'],
  },
  {
    id: 'react.feature',
    name: 'Feature module',
    category: 'module',
    icon: 'puzzle',
    idPrefix: 'feat',
    defaultLayer: 'presentation',
    allowedParents: ['react.app', 'group.layer'],
    propertySchema: z
      .object({
        folder: z.string(),
        fsdLayer: z.enum(['app', 'pages', 'widgets', 'features', 'entities', 'shared']),
      })
      .partial(),
    palette: { group: 'Frontend', order: 40, basic: true },
    docs: 'A folder that holds one feature: its components, hooks and state (for example `src/features/cart`).',
    aliases: ['fsd', 'slice', 'feature folder'],
  },
  {
    id: 'react.component',
    name: 'Shared component',
    category: 'ui',
    shape: 'rounded',
    icon: 'component',
    idPrefix: 'cmp',
    allowedParents: ['react.app', 'react.feature', 'react.design-system'],
    propertySchema: z.object({ folder: z.string() }).partial(),
    palette: { group: 'Frontend', order: 50, basic: false },
    docs: 'A reusable component used by several routes or features.',
    aliases: ['widget', 'ui'],
  },
  {
    id: 'react.design-system',
    name: 'UI kit / design system',
    category: 'module',
    icon: 'palette',
    idPrefix: 'ds',
    defaultLayer: 'presentation',
    allowedParents: ['top', 'group.*', 'react.app'],
    propertySchema: z.object({ package: z.string() }).partial(),
    palette: { group: 'Frontend', order: 60, basic: false },
    docs: 'A shared component library, often its own workspace package.',
    aliases: ['ui kit', 'component library', 'shadcn', 'mui'],
  },
  {
    id: 'react.hook',
    name: 'Custom hook',
    category: 'module',
    icon: 'link',
    idPrefix: 'hook',
    defaultLayer: 'presentation',
    allowedParents: ['react.app', 'react.feature'],
    palette: { group: 'Frontend', order: 70, basic: false },
    docs: 'A custom React hook that holds reusable logic (`useCart`, `useOrders`).',
    aliases: ['use'],
  },
  {
    id: 'react.server-state',
    name: 'Server-state cache',
    category: 'client-state',
    icon: 'database-zap',
    idPrefix: 'qcache',
    allowedParents: ['react.app'],
    propertySchema: z
      .object({
        lib: z.enum(['tanstack-query', 'swr', 'rtk-query', 'apollo']),
        staleTimeMs: z.number().int().nonnegative(),
        optimisticUpdates: z.boolean(),
      })
      .partial(),
    palette: { group: 'Frontend', order: 80, basic: true },
    docs: 'Caches data from the backend in the browser: TanStack Query, SWR, RTK Query, Apollo.',
    aliases: ['react query', 'tanstack query', 'swr', 'apollo', 'cache'],
  },
  {
    id: 'react.client-store',
    name: 'Client state store',
    category: 'client-state',
    icon: 'store',
    idPrefix: 'store-ui',
    allowedParents: ['react.app', 'react.feature'],
    propertySchema: z
      .object({
        lib: z.enum(['zustand', 'redux-toolkit', 'context', 'jotai']),
        persist: z.enum(['none', 'local-storage', 'session-storage', 'indexeddb']),
      })
      .partial(),
    palette: { group: 'Frontend', order: 90, basic: false },
    docs: 'Holds state that many parts of the app share in the browser (cart, filters, signed-in user, UI flags): Redux Toolkit, Zustand, Context, Jotai. Components read it; actions change it. Data from the server belongs in a server-state cache.',
    aliases: ['redux', 'redux store', 'zustand', 'context', 'jotai', 'state', 'global state'],
  },
  {
    id: 'react.action',
    name: 'Action / thunk',
    category: 'module',
    icon: 'send',
    idPrefix: 'act',
    defaultLayer: 'presentation',
    allowedParents: ['react.app', 'react.feature'],
    propertySchema: z
      .object({
        kind: z.enum(['redux-action', 'redux-thunk', 'zustand-action', 'reducer-case']),
        async: z.boolean(),
      })
      .partial(),
    palette: { group: 'Frontend', order: 92, basic: false },
    docs: 'A named change to client state: a Redux action and its reducer case, a thunk (`createAsyncThunk`) that calls the API first, or a Zustand action. UI code dispatches it; it updates the store.',
    aliases: [
      'redux action',
      'thunk',
      'createAsyncThunk',
      'reducer',
      'slice',
      'dispatch',
      'zustand action',
    ],
  },
  {
    id: 'react.effect',
    name: 'Effect (useEffect)',
    category: 'module',
    icon: 'refresh-cw',
    idPrefix: 'eff',
    defaultLayer: 'presentation',
    allowedParents: ['react.app', 'react.feature'],
    propertySchema: z
      .object({
        /** What makes it run again, e.g. ["orderId"]; empty = on mount only. */
        dependencies: z.array(z.string()),
        cleanup: z.boolean(),
      })
      .partial(),
    palette: { group: 'Frontend', order: 95, basic: false },
    docs: 'Code that runs after React renders, to sync with something outside React: load data when a page opens, dispatch an action when an ID changes, subscribe to a WebSocket and clean up.',
    aliases: ['useEffect', 'effect', 'side effect', 'on mount', 'lifecycle', 'useLayoutEffect'],
  },
  {
    id: 'react.api-client',
    name: 'API client',
    category: 'adapter',
    icon: 'plug',
    idPrefix: 'apic',
    defaultLayer: 'presentation',
    allowedParents: ['react.app'],
    propertySchema: z
      .object({ kind: z.enum(['fetch', 'axios', 'openapi-generated', 'trpc', 'graphql']) })
      .partial(),
    palette: { group: 'Frontend', order: 100, basic: true },
    docs: 'The layer that talks to the backend: a fetch wrapper, axios, a generated OpenAPI client, or tRPC.',
    aliases: ['axios', 'fetch', 'trpc', 'openapi', 'http client'],
  },
];

/** Node.js concepts (Implementation.md §9.6). */
const NODE: Concept[] = [
  {
    id: 'node.service',
    name: 'Node service',
    category: 'deployable',
    icon: 'server',
    idPrefix: 'svc',
    allowedParents: TOP_OR_GROUP,
    propertySchema: nodeServiceProps,
    palette: { group: 'Backend', order: 10, basic: true },
    docs: 'A Node.js process that serves requests (Express, Fastify or NestJS).',
    aliases: ['api', 'backend', 'express', 'fastify', 'nestjs', 'server'],
  },
  {
    id: 'node.bff',
    name: 'Backend-for-Frontend',
    category: 'deployable',
    icon: 'split',
    idPrefix: 'bff',
    allowedParents: TOP_OR_GROUP,
    propertySchema: nodeServiceProps.extend({ client: z.string() }).partial(),
    palette: { group: 'Backend', order: 20, basic: true },
    docs: 'A Node service made for one frontend. It aggregates backend services for that client.',
    aliases: ['bff', 'aggregator', 'edge api'],
  },
  {
    id: 'node.worker',
    name: 'Background worker',
    category: 'deployable',
    icon: 'cog',
    idPrefix: 'wrk',
    allowedParents: TOP_OR_GROUP,
    propertySchema: z
      .object({
        jobLib: z.enum(['pg-boss', 'graphile-worker']),
        /** Jobs one instance runs at the same time. */
        concurrency: z.number().int().positive(),
        dataAccess,
        ...scalingProps,
      })
      .partial(),
    palette: { group: 'Backend', order: 30, basic: true },
    docs: 'A Node process that runs jobs from a queue (pg-boss, graphile-worker).',
    aliases: ['job', 'consumer', 'pg-boss', 'graphile'],
  },
  {
    id: 'node.scheduler',
    name: 'Scheduled job',
    category: 'deployable',
    icon: 'clock',
    idPrefix: 'cron',
    allowedParents: ['top', 'group.*', 'node.service', 'node.worker'],
    propertySchema: z
      .object({ lib: z.enum(['pg-boss', 'node-cron', 'pg_cron']), cron: z.string() })
      .partial(),
    palette: { group: 'Backend', order: 40, basic: false },
    docs: 'Work that runs on a schedule (pg-boss schedule, node-cron, pg_cron).',
    aliases: ['cron', 'schedule', 'timer'],
  },
  {
    id: 'node.ws-gateway',
    name: 'Realtime gateway',
    category: 'routing',
    icon: 'radio',
    idPrefix: 'ws',
    defaultLayer: 'application',
    allowedParents: ['top', 'group.*', 'node.service'],
    propertySchema: z.object({ lib: z.enum(['socket.io', 'ws']) }).partial(),
    palette: { group: 'Backend', order: 50, basic: false },
    docs: 'Keeps WebSocket connections to browsers and pushes updates (Socket.IO, ws).',
    aliases: ['websocket', 'socket.io', 'realtime', 'push'],
  },
  {
    id: 'node.module',
    name: 'Module',
    category: 'module',
    icon: 'package',
    idPrefix: 'mod',
    allowedParents: [...NODE_DEPLOYABLES, 'group.*'],
    propertySchema: z.object({ exports: z.array(z.string()) }).partial(),
    palette: { group: 'Backend', order: 60, basic: true },
    docs: 'A NestJS module or a feature folder with a public API.',
    aliases: ['nest module', 'feature'],
  },
  {
    id: 'node.route-handler',
    name: 'Controller / route handler',
    category: 'module',
    icon: 'route',
    idPrefix: 'ctl',
    allowedParents: NODE_CODE_PARENTS,
    propertySchema: z
      .object({
        routes: z.array(z.string()),
        validation: z.enum(['zod', 'joi', 'class-validator', 'typebox', 'none']),
      })
      .partial(),
    palette: { group: 'Backend', order: 70, basic: true },
    docs: 'Receives HTTP requests: an Express router, Fastify routes or a NestJS controller.',
    aliases: ['controller', 'router', 'endpoint', 'handler'],
  },
  {
    id: 'node.middleware',
    name: 'Middleware',
    category: 'module',
    icon: 'filter',
    idPrefix: 'mw',
    allowedParents: NODE_CODE_PARENTS,
    propertySchema: z
      .object({
        kind: z.enum(['auth', 'validation', 'rate-limit', 'error', 'other']),
        authMethod: z.enum(['session', 'jwt', 'api-key', 'oauth-introspection']),
        roles: z.array(z.string()),
      })
      .partial(),
    palette: { group: 'Backend', order: 80, basic: false },
    docs: 'Runs before or after handlers: auth, validation, rate limiting, error handling.',
    aliases: ['guard', 'interceptor', 'passport', 'jwt'],
  },
  {
    id: 'node.use-case',
    name: 'Use case / application service',
    category: 'module',
    icon: 'workflow',
    idPrefix: 'uc',
    allowedParents: NODE_CODE_PARENTS,
    palette: { group: 'Backend', order: 90, basic: true },
    docs: 'One application action (`PlaceOrder`). It coordinates domain objects and ports.',
    aliases: ['service', 'application service', 'command', 'interactor'],
  },
  {
    id: 'node.domain',
    name: 'Domain model / aggregate',
    category: 'domain-core',
    icon: 'hexagon',
    idPrefix: 'dom',
    allowedParents: [...NODE_CODE_PARENTS, 'group.context'],
    propertySchema: z.object({ invariants: z.array(z.string()) }).partial(),
    palette: { group: 'Backend', order: 100, basic: true },
    docs: 'Business rules and state, free of frameworks and I/O.',
    aliases: ['aggregate', 'entity', 'domain', 'model'],
  },
  {
    id: 'node.port',
    name: 'Port (interface)',
    category: 'port',
    icon: 'circle-dot',
    idPrefix: 'port',
    allowedParents: NODE_CODE_PARENTS,
    palette: { group: 'Backend', order: 110, basic: true },
    docs: 'An interface the application needs (`OrderRepository`, `PaymentGateway`). Adapters implement it.',
    aliases: ['interface', 'contract', 'abstraction'],
  },
  {
    id: 'node.repository',
    name: 'Repository / data access',
    category: 'adapter',
    icon: 'plug-zap',
    idPrefix: 'repo',
    allowedParents: NODE_CODE_PARENTS,
    propertySchema: z.object({ dataAccess }).partial(),
    palette: { group: 'Backend', order: 120, basic: true },
    docs: 'Reads and writes the database through an ORM or query builder.',
    aliases: ['prisma', 'drizzle', 'typeorm', 'kysely', 'knex', 'dao', 'orm'],
  },
  {
    id: 'node.event',
    name: 'Domain / integration event',
    category: 'event',
    icon: 'zap',
    idPrefix: 'evt',
    allowedParents: ['top', 'group.*', ...NODE_CODE_PARENTS],
    propertySchema: z.object({ payloadSchema: z.string() }).partial(),
    palette: { group: 'Events', order: 10, basic: true },
    docs: 'A fact that happened (`OrderPlaced`). Other parts react to it.',
    aliases: ['event', 'message', 'fact'],
  },
  {
    id: 'node.contract',
    name: 'API contract package',
    category: 'port',
    icon: 'file-code',
    idPrefix: 'api',
    allowedParents: TOP_OR_GROUP,
    propertySchema: z
      .object({ kind: z.enum(['openapi', 'zod', 'trpc-router', 'graphql-schema']) })
      .partial(),
    palette: { group: 'Backend', order: 130, basic: false },
    docs: 'Shared API types for client and server: OpenAPI, zod schemas, a tRPC router type, a GraphQL schema.',
    aliases: ['openapi', 'swagger', 'zod', 'schema', 'types'],
  },
  {
    id: 'node.endpoint',
    name: 'API endpoint',
    category: 'module',
    icon: 'arrow-right-left',
    idPrefix: 'ep',
    allowedParents: ['node.route-handler', 'node.contract'],
    nestingHint:
      'Endpoints live inside a route handler (code-first) or an API contract (contract-first).',
    propertySchema: z
      .object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().startsWith('/'),
        /** ID of the request data shape (node.dto). */
        request: z.string(),
        /** ID of the response data shape (node.dto). */
        response: z.string(),
        statusCodes: z.array(z.number().int().min(100).max(599)),
        auth: z.enum(['none', 'required', 'roles']),
        roles: z.array(z.string()),
        idempotent: z.boolean(),
        pagination: z.enum(['none', 'offset', 'cursor']),
        returnsList: z.boolean(),
        version: z.string(),
      })
      .partial(),
    palette: { group: 'Backend', order: 75, basic: true },
    docs: 'One operation of an API: method, path, request and response shapes, status codes and auth (`POST /orders`).',
    aliases: ['route', 'rest', 'operation', 'http', 'api design'],
  },
  {
    id: 'node.dto',
    name: 'Data shape (DTO)',
    category: 'schema',
    icon: 'file-json',
    idPrefix: 'dto',
    allowedParents: [
      'top',
      'group.*',
      'node.contract',
      'node.shared-lib',
      'node.module',
      'node.route-handler',
      'node.service',
      'node.bff',
      'react.app',
      'react.feature',
    ],
    propertySchema: z
      .object({
        role: z.enum(['request', 'response', 'event-payload', 'view-model', 'shared']),
        format: z.enum(['zod', 'typescript', 'json-schema', 'openapi', 'graphql']),
        fields: z.array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            required: z.boolean().optional(),
            description: z.string().optional(),
          }),
        ),
      })
      .partial(),
    palette: { group: 'Backend', order: 135, basic: true },
    docs: 'The shape of data that crosses a boundary: a request body, a response, an event payload. Not the same as the domain model or the table.',
    aliases: ['dto', 'model', 'schema', 'payload', 'type', 'interface', 'zod'],
  },
  {
    id: 'node.shared-lib',
    name: 'Shared package',
    category: 'module',
    icon: 'library',
    idPrefix: 'lib',
    allowedParents: TOP_OR_GROUP,
    propertySchema: z.object({ package: z.string() }).partial(),
    palette: { group: 'Backend', order: 140, basic: false },
    docs: 'A workspace package used by several apps (utils, config, types).',
    aliases: ['package', 'utils', 'common'],
  },
];

/** PostgreSQL concepts (Implementation.md §9.7). */
const POSTGRES: Concept[] = [
  {
    id: 'pg.cluster',
    name: 'Postgres server',
    category: 'group',
    icon: 'server-cog',
    idPrefix: 'pgc',
    defaultLayer: 'data',
    allowedParents: ['top', 'group.zone'],
    propertySchema: z
      .object({
        version: z.string(),
        hosting: z.enum([
          'self',
          'rds',
          'aurora',
          'cloud-sql',
          'azure',
          'neon',
          'supabase',
          'other',
        ]),
      })
      .partial(),
    palette: { group: 'Data', order: 10, basic: false },
    docs: 'A PostgreSQL server (instance) that holds one or more databases.',
    aliases: ['instance', 'rds', 'neon', 'supabase', 'server'],
  },
  {
    id: 'pg.database',
    name: 'Database',
    category: 'data-at-rest',
    icon: 'database',
    idPrefix: 'db',
    allowedParents: ['top', 'group.*', 'pg.cluster'],
    propertySchema: z
      .object({ extensions: z.array(z.string()), maxConnections: z.number().int().positive() })
      .partial(),
    palette: { group: 'Data', order: 20, basic: true },
    docs: 'A PostgreSQL database.',
    aliases: ['postgres', 'postgresql', 'db', 'sql'],
  },
  {
    id: 'pg.schema',
    name: 'Schema',
    category: 'data-at-rest',
    icon: 'folder-tree',
    idPrefix: 'schema',
    allowedParents: ['pg.database'],
    nestingHint: 'Schemas live inside a database.',
    propertySchema: z
      .object({
        ownedBy: z.string(),
        migrationTool: z.enum([
          'prisma-migrate',
          'drizzle-kit',
          'node-pg-migrate',
          'typeorm',
          'knex',
          'sql',
        ]),
        rls: z.boolean(),
      })
      .partial(),
    palette: { group: 'Data', order: 30, basic: true },
    docs: 'A namespace of tables. The ownership boundary: one service owns its migrations.',
    aliases: ['namespace', 'public'],
  },
  {
    id: 'pg.table',
    name: 'Table',
    category: 'data-at-rest',
    shape: 'rect',
    icon: 'table',
    idPrefix: 'tbl',
    allowedParents: ['pg.schema'],
    nestingHint: 'Tables live in a schema (default: public).',
    propertySchema: z
      .object({
        columns: z.array(
          z.object({ name: z.string(), type: z.string(), nullable: z.boolean().optional() }),
        ),
        primaryKey: z.array(z.string()),
        foreignKeys: z.array(
          z.object({
            columns: z.array(z.string()),
            references: z.string(),
            refColumns: z.array(z.string()),
          }),
        ),
        indexes: z.array(
          z.object({ columns: z.array(z.string()), unique: z.boolean().optional() }),
        ),
      })
      .partial(),
    palette: { group: 'Data', order: 40, basic: false },
    docs: 'A table. Usually shown in the database drill-down view.',
    aliases: ['entity', 'relation'],
  },
  {
    id: 'pg.function',
    name: 'Function / stored procedure',
    category: 'module',
    icon: 'square-function',
    idPrefix: 'fn',
    defaultLayer: 'data',
    allowedParents: ['pg.schema'],
    nestingHint: 'Functions and procedures live in a schema.',
    propertySchema: z
      .object({
        kind: z.enum(['function', 'procedure']),
        language: z.enum(['sql', 'plpgsql']),
        volatility: z.enum(['immutable', 'stable', 'volatile']),
        securityDefiner: z.boolean(),
        returns: z.string(),
      })
      .partial(),
    palette: { group: 'Data', order: 45, basic: true },
    docs: 'Code that runs inside PostgreSQL, next to the data (`CREATE FUNCTION` / `CREATE PROCEDURE`).',
    aliases: ['stored procedure', 'procedure', 'plpgsql', 'sql function', 'rpc'],
  },
  {
    id: 'pg.trigger',
    name: 'Trigger',
    category: 'module',
    icon: 'zap',
    idPrefix: 'trg',
    defaultLayer: 'data',
    allowedParents: ['pg.schema'],
    nestingHint: 'Triggers live in a schema.',
    propertySchema: z
      .object({
        timing: z.enum(['before', 'after', 'instead-of']),
        events: z.array(z.enum(['insert', 'update', 'delete', 'truncate'])),
        level: z.enum(['row', 'statement']),
      })
      .partial(),
    palette: { group: 'Data', order: 46, basic: false },
    docs: 'Runs a function automatically when rows in a table change (audit logs, updated_at columns, denormalized counters).',
    aliases: ['on insert', 'on update', 'audit'],
  },
  {
    id: 'pg.view',
    name: 'View / materialized view',
    category: 'data-at-rest',
    shape: 'cylinder-dashed',
    icon: 'eye',
    idPrefix: 'view',
    allowedParents: ['pg.schema'],
    nestingHint: 'Views live in a schema.',
    propertySchema: z
      .object({ materialized: z.boolean(), refresh: z.enum(['manual', 'scheduled', 'on-commit']) })
      .partial(),
    palette: { group: 'Data', order: 50, basic: false },
    docs: 'A read-only query over tables. Materialized views store the result (good for read models).',
    aliases: ['materialized', 'read model', 'projection'],
  },
  {
    id: 'pg.replica',
    name: 'Read replica',
    category: 'data-at-rest',
    icon: 'copy',
    idPrefix: 'replica',
    allowedParents: ['top', 'group.*', 'pg.cluster'],
    propertySchema: z.object({ lagTolerance: z.string() }).partial(),
    palette: { group: 'Data', order: 60, basic: false },
    docs: 'A read-only copy of a database, for read scaling or reporting.',
    aliases: ['standby', 'read only', 'follower'],
  },
  {
    id: 'pg.pooler',
    name: 'Connection pooler',
    category: 'routing',
    icon: 'git-merge',
    idPrefix: 'pool',
    defaultLayer: 'data',
    allowedParents: ['top', 'group.*', 'pg.cluster'],
    propertySchema: z
      .object({
        kind: z.enum(['pgbouncer', 'pgcat', 'rds-proxy', 'supavisor', 'app-pool']),
        mode: z.enum(['transaction', 'session']),
      })
      .partial(),
    palette: { group: 'Infra', order: 40, basic: false },
    docs: 'Shares a small number of database connections between many app instances (PgBouncer, RDS Proxy).',
    aliases: ['pgbouncer', 'pool', 'proxy', 'rds proxy'],
  },
  {
    id: 'pg.job-queue',
    name: 'Postgres job queue',
    category: 'data-in-motion',
    icon: 'list-todo',
    idPrefix: 'jobs',
    allowedParents: ['top', 'group.*', 'pg.database', 'pg.schema'],
    propertySchema: z
      .object({
        lib: z.enum(['pg-boss', 'graphile-worker']),
        queues: z.array(z.string()),
        /** Jobs that keep failing move to a dead-letter queue (pg-boss `deadLetter`). */
        deadLetter: z.boolean(),
      })
      .partial(),
    palette: { group: 'Events', order: 20, basic: true },
    docs: 'A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data.',
    aliases: ['pg-boss', 'graphile-worker', 'queue', 'jobs', 'background'],
  },
  {
    id: 'pg.channel',
    name: 'LISTEN/NOTIFY channel',
    category: 'data-in-motion',
    icon: 'bell',
    idPrefix: 'chan',
    allowedParents: ['top', 'group.*', 'pg.database'],
    propertySchema: z.object({ channel: z.string() }).partial(),
    palette: { group: 'Events', order: 30, basic: false },
    docs: 'A Postgres NOTIFY channel. Fast, but not durable: listeners that are offline miss messages.',
    aliases: ['notify', 'listen', 'pubsub'],
  },
];

export const CONCEPTS: Concept[] = [...REACT, ...NODE, ...POSTGRES];
