import type { RelationRule, RelationType } from '@archguide/core';
import { PYTHON_DOTNET_DEPLOYABLES } from './concepts';

/** Node elements that run code and can talk to Postgres. */
const NODE_ACTORS = [
  ...PYTHON_DOTNET_DEPLOYABLES,
  'node.service',
  'node.bff',
  'node.worker',
  'node.scheduler',
  'node.module',
  'node.route-handler',
  'node.endpoint',
  'node.use-case',
  'node.repository',
];

const DB_CODE = ['pg.function', 'pg.trigger'];
/** Backend elements that hold server-only code. Contracts, DTOs and shared packages are not in it. */
const SERVER_CODE = [
  ...PYTHON_DOTNET_DEPLOYABLES,
  'node.service',
  'node.bff',
  'node.worker',
  'node.scheduler',
  'node.ws-gateway',
  'node.module',
  'node.route-handler',
  'node.endpoint',
  'node.middleware',
  'node.use-case',
  'node.domain',
  'node.port',
  'node.repository',
];

/** Relation types added by the profile (Implementation.md §10.2). */
export const RELATION_TYPES: RelationType[] = [
  {
    id: 'invokes',
    name: 'invokes',
    mode: 'sync',
    line: { width: 1.5, marker: 'arrow' },
    defaultPriority: 15,
    hint: 'Node code, functions and triggers invoke a database function or procedure.',
    docs: 'Runs a database function or procedure (`SELECT fn(...)`, `CALL proc(...)`, or `EXECUTE FUNCTION` in a trigger).',
  },
  {
    id: 'fires-on',
    name: 'fires on',
    mode: 'static',
    line: { dash: '4 3', width: 1, marker: 'arrow' },
    defaultPriority: 16,
    hint: 'A trigger fires on a table or a view.',
    docs: 'The trigger runs when rows of this table (or view) change.',
  },
  {
    id: 'migrates',
    name: 'migrates',
    mode: 'static',
    line: { dash: '2 3', width: 2.5, marker: 'arrow' },
    defaultPriority: 25,
    hint: 'Only Node services and workers run migrations, on a schema or a database.',
    docs: 'This element owns the DDL (migrations) of the schema. One owner per schema.',
  },
  {
    id: 'enqueues',
    name: 'enqueues',
    mode: 'async',
    specializes: 'publishes',
    line: { dash: '6 4', width: 1.5, marker: 'open-arrow' },
    defaultPriority: 28,
    hint: 'Node code enqueues jobs into a Postgres job queue.',
    docs: 'Adds a job to a Postgres job queue. Set `inTransaction` when the job is added in the same transaction as the data.',
  },
  {
    id: 'processes',
    name: 'processes',
    mode: 'async',
    specializes: 'consumes',
    line: { dash: '6 4', width: 1.5, marker: 'open-arrow' },
    defaultPriority: 29,
    hint: 'Only Node workers or services run jobs from a Postgres job queue.',
    docs: 'Runs jobs from a Postgres job queue.',
  },
  {
    id: 'notifies',
    name: 'notifies',
    mode: 'async',
    line: { dash: '4 3', width: 1, marker: 'open-arrow' },
    defaultPriority: 32,
    hint: 'Node code sends NOTIFY on a LISTEN/NOTIFY channel.',
    docs: 'Sends `NOTIFY` on a channel.',
  },
  {
    id: 'listens',
    name: 'listens',
    mode: 'async',
    line: { dash: '4 3', width: 1, marker: 'open-arrow' },
    defaultPriority: 33,
    hint: 'Node code listens on a LISTEN/NOTIFY channel.',
    docs: 'Runs `LISTEN` on a channel.',
  },
  {
    id: 'connects-via',
    name: 'connects via',
    mode: 'sync',
    line: { width: 1, marker: 'arrow' },
    defaultPriority: 22,
    hint: 'Node code connects to a pooler, and a pooler connects to a database.',
    docs: 'Database connections go through a connection pooler.',
  },
  {
    id: 'replicates-to',
    name: 'replicates to',
    mode: 'async',
    line: { dash: '2 3', width: 1, marker: 'arrow' },
    defaultPriority: 80,
    hint: 'A database replicates to a read replica.',
    docs: 'Physical or logical replication.',
  },
  {
    id: 'serves',
    name: 'serves',
    mode: 'static',
    line: { width: 1, marker: 'open-arrow' },
    defaultPriority: 55,
    hint: 'A Node service, a BFF or a CDN serves the build of a React app.',
    docs: 'Delivers the static build of the React app to browsers.',
  },
  {
    id: 'uses-state',
    name: 'uses state',
    mode: 'static',
    line: { dash: '2 3', width: 1, marker: 'open-arrow' },
    defaultPriority: 52,
    hint: 'React routes, features, components and hooks use a client store or server-state cache.',
    docs: 'Reads or updates a client store or a server-state cache.',
  },
  {
    id: 'dispatches',
    name: 'dispatches',
    mode: 'sync',
    line: { width: 1, marker: 'arrow' },
    defaultPriority: 50,
    hint: 'React routes, features, components, hooks and effects dispatch actions.',
    docs: 'Starts an action: `dispatch(addToCart(item))`, or calls a Zustand action.',
  },
  {
    id: 'updates',
    name: 'updates',
    mode: 'sync',
    line: { width: 1.5, marker: 'arrow' },
    defaultPriority: 51,
    hint: 'An action updates a client store or a server-state cache.',
    docs: 'Changes the state in the store (a reducer case, `set()` in Zustand), or updates or invalidates cached server data.',
  },
  {
    id: 'fetches-via',
    name: 'fetches via',
    mode: 'sync',
    line: { width: 1, marker: 'arrow' },
    defaultPriority: 53,
    hint: 'React code fetches data through an API client.',
    docs: 'Loads data through the API client.',
  },
];

/** Profile rules. They are checked before the core rules, so their deny messages win. */
export const RELATION_RULES: RelationRule[] = [
  // Deny rules (Implementation.md §10.4).
  {
    type: 'renders',
    deny: { from: ['group:Backend', 'group:Data'] },
    message: 'Only React code renders UI.',
  },
  {
    type: 'renders',
    deny: { to: ['group:Backend', 'group:Data'] },
    message: 'Only React code renders UI.',
  },
  {
    type: 'navigates',
    deny: { to: ['react.component'] },
    message: 'Users navigate to routes, not to components. Point the relation at a route.',
  },
  {
    type: 'depends-on',
    deny: { from: ['group:Frontend'], to: SERVER_CODE },
    message:
      'Browser code must not import server code. Share types through an API contract or a data shape (DTO).',
  },
  {
    type: '*',
    deny: { from: DB_CODE, to: ['gen.*', 'node.*', 'react.*'] },
    message: 'Database code only works with database objects. Let the application read the result.',
  },
  {
    type: ['calls', 'depends-on'],
    deny: { to: DB_CODE },
    message:
      'Run database functions with "invokes" (SELECT fn(...) or CALL proc(...)). Triggers run by themselves when their table changes.',
  },
  {
    type: [
      'depends-on',
      'renders',
      'emits',
      'handles',
      'publishes',
      'consumes',
      'authenticates-with',
    ],
    deny: { from: DB_CODE },
    message:
      'Database functions call other functions with "invokes", and send messages with "notifies" or "enqueues".',
  },
  {
    type: 'migrates',
    deny: { from: ['group:Frontend'] },
    message: 'Migrations run from backend code.',
  },
  {
    type: '*',
    deny: { from: ['group:Frontend'], to: ['pg.*'] },
    message: 'Browser code cannot connect to PostgreSQL. Go through a Node service.',
  },
  {
    type: 'calls',
    deny: { from: ['pg.*'] },
    message: 'PostgreSQL does not call services. Did you mean the service reads or writes it?',
  },
  {
    type: 'calls',
    deny: { to: ['pg.pooler'] },
    message: 'A pooler only forwards database connections. Use "connects-via".',
  },
  {
    type: 'writes',
    deny: { to: ['pg.replica'] },
    message: 'Replicas are read-only. Write to the primary database.',
  },
  {
    type: 'writes',
    deny: { to: ['pg.view'] },
    message: 'Views are read-only. Write to the tables and refresh the view.',
  },
  {
    type: ['publishes', 'consumes'],
    deny: { to: ['pg.job-queue'] },
    message: 'Use "enqueues" (producer) or "processes" (worker) for a Postgres job queue.',
  },
  {
    type: ['publishes', 'consumes'],
    deny: { to: ['pg.channel'] },
    message: 'Use "notifies" or "listens" for a LISTEN/NOTIFY channel.',
  },
  {
    type: 'calls',
    deny: { from: ['group:Backend', 'group:Data'], to: ['group:Frontend'] },
    message:
      'A server cannot call browser code. Let the React app connect to a realtime gateway that pushes updates.',
  },

  // Allow rules.
  {
    type: 'migrates',
    from: ['node.service', 'node.bff', 'node.worker', ...PYTHON_DOTNET_DEPLOYABLES],
    to: ['pg.schema', 'pg.database'],
  },
  { type: 'invokes', from: [...NODE_ACTORS, ...DB_CODE], to: ['pg.function'] },
  { type: 'fires-on', from: ['pg.trigger'], to: ['pg.table', 'pg.view'] },
  // graphile-worker's add_job() and pg_notify() can be called from SQL as well.
  { type: 'enqueues', from: [...NODE_ACTORS, ...DB_CODE], to: ['pg.job-queue'] },
  {
    type: 'processes',
    from: ['node.worker', 'py.worker', 'dotnet.worker'],
    to: ['pg.job-queue'],
    priority: 27,
  },
  {
    type: 'processes',
    from: ['node.service', 'py.service', 'dotnet.service', 'node.module', 'node.use-case'],
    to: ['pg.job-queue'],
  },
  { type: 'notifies', from: [...NODE_ACTORS, ...DB_CODE], to: ['pg.channel'] },
  { type: 'listens', from: [...NODE_ACTORS, 'node.ws-gateway'], to: ['pg.channel'] },
  { type: 'connects-via', from: NODE_ACTORS, to: ['pg.pooler'] },
  { type: 'connects-via', from: ['pg.pooler'], to: ['pg.database'] },
  { type: 'replicates-to', from: ['pg.database'], to: ['pg.replica'] },
  {
    type: 'serves',
    from: ['node.service', 'node.bff', 'py.service', 'dotnet.service', 'gen.cdn'],
    to: ['react.app'],
  },
  {
    type: 'uses-state',
    from: [
      'react.route',
      'react.layout',
      'react.feature',
      'react.component',
      'react.hook',
      'react.effect',
    ],
    to: ['react.client-store', 'react.server-state'],
  },
  {
    type: 'fetches-via',
    from: [
      'react.server-state',
      'react.hook',
      'react.feature',
      'react.route',
      'react.action',
      'react.effect',
    ],
    to: ['react.api-client'],
  },
  {
    type: 'dispatches',
    from: [
      'react.route',
      'react.layout',
      'react.feature',
      'react.component',
      'react.hook',
      'react.effect',
      'react.action',
    ],
    to: ['react.action'],
  },
  { type: 'updates', from: ['react.action'], to: ['react.client-store', 'react.server-state'] },
  // A page or component calls a custom hook, or runs an effect, that lives in its own file.
  {
    type: 'depends-on',
    from: ['react.route', 'react.layout', 'react.component'],
    to: ['react.hook', 'react.effect'],
  },
];
