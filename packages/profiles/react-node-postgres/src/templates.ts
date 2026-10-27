import { slugify } from '@archguide/core';
import type { Template, TemplateBuilder } from '@archguide/core';

/** Built-in templates of the React + Node.js + PostgreSQL profile (Implementation.md §12.2). */

// Default shape sizes (core SHAPES) used to lay templates out on a grid.
const M = 140; // rounded: modules, handlers, use cases
const MH = 64;
const GAP = 48;
/** Top-left of the first child inside a container (below its header). */
const IN = { x: 16, y: 40 };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const str = (v: unknown): string => String(v);
/** "Order Item" → "order_items": the table that stores an entity. */
const tableName = (entity: string) => {
  const s = slugify(entity).replace(/-/g, '_');
  return s.endsWith('s') ? s : `${s}s`;
};

/** Columns every entity table starts with: a UUID key and timestamps. */
function entityTable(extra: { name: string; type: string; nullable: boolean }[] = []) {
  return {
    columns: [
      { name: 'id', type: 'uuid', nullable: false },
      ...extra,
      { name: 'created_at', type: 'timestamptz', nullable: false },
      { name: 'updated_at', type: 'timestamptz', nullable: false },
    ],
    primaryKey: ['id'],
  };
}

/** An auth middleware inside a service: how the service checks who is calling. */
function authMiddleware(b: TemplateBuilder, key: string, parent: string, x: number, y: number) {
  return b.el(key, 'node.middleware', 'Auth middleware', {
    parent,
    x,
    y,
    properties: { kind: 'auth', authMethod: 'session' },
    responsibilities: ['Read the session cookie', 'Reject calls without a valid session'],
  });
}

const starter: Template = {
  id: 'rnp.starter',
  code: 'T1',
  version: '1.0.0',
  name: 'Starter: React + Express + PostgreSQL',
  category: 'fullstack',
  summary:
    'A React app calls one Node.js REST API, which owns one PostgreSQL schema. The smallest complete full-stack design.',
  whenToUse: [
    'A new product or a prototype with one team.',
    'Learning how the three parts of a web application fit together.',
  ],
  whenNotToUse: ['Several teams need to deploy parts of the backend on their own.'],
  tradeoffs: [
    'Simple to build, run and debug: one deploy, one database.',
    'Everything grows in one codebase; keep modules inside the API clear as it grows.',
  ],
  parameters: [
    { key: 'appName', label: 'App name', type: 'string', default: 'Shop' },
    { key: 'apiName', label: 'API name', type: 'string', default: 'Shop API' },
    { key: 'dbName', label: 'Database name', type: 'string', default: 'Shop DB' },
  ],
  rulePacks: ['core', 'frontend', 'security', 'api'],
  invariants: [
    'The {appName} React app MUST NOT connect to PostgreSQL; it calls {apiName} over HTTP.',
    'Only {apiName} MAY write and migrate the "public" schema of {dbName}.',
    'Auth tokens MUST live in an HttpOnly cookie, not in localStorage.',
  ],
  folderLayout: {
    'react.app': 'apps/web/**',
    'node.service': 'apps/api/**',
    'pg.schema': 'apps/api/prisma/**',
  },
  learnId: 'pattern.starter',
  build(p, b) {
    b.el('user', 'gen.actor', 'Customer', { x: 0, y: 40 });
    b.el('app', 'react.app', str(p.appName), {
      x: 120,
      y: 0,
      properties: {
        bundler: 'vite',
        router: 'react-router',
        rendering: 'csr',
        tokenStorage: 'http-only-cookie',
      },
    });
    b.el('home', 'react.route', 'Home', { parent: 'app', ...IN, properties: { path: '/' } });
    b.el('api', 'node.service', str(p.apiName), {
      x: 440,
      y: 0,
      properties: { framework: 'express', transport: ['rest'], dataAccess: 'prisma' },
    });
    authMiddleware(b, 'auth', 'api', IN.x, IN.y);
    b.el('db', 'pg.database', str(p.dbName), { x: 780, y: 0 });
    b.el('schema', 'pg.schema', 'public', {
      parent: 'db',
      ...IN,
      properties: { migrationTool: 'prisma-migrate' },
    });
    b.rel('user', 'calls', 'app', { label: 'uses' });
    b.rel('app', 'calls', 'api', { protocol: 'http', label: 'REST /api' });
    b.rel('api', 'reads', 'schema', { via: 'prisma' });
    b.rel('api', 'writes', 'schema', { via: 'prisma' });
    b.rel('api', 'migrates', 'schema');
    b.step({
      title: 'The browser part',
      body: 'Customers use the {appName} React app. It only renders screens and calls the API; it never holds database credentials.',
      elements: ['user', 'app'],
      conceptIds: ['react.app'],
    });
    b.step({
      title: 'The API',
      body: '{apiName} is the only way in. Its auth middleware checks the session cookie on every request.',
      elements: ['api', 'auth'],
      relations: ['app>calls>api'],
      conceptIds: ['topic.authentication'],
    });
    b.step({
      title: 'The data',
      body: 'One schema, owned by the API: it reads, writes and migrates it. One owner per schema keeps changes safe.',
      elements: ['db', 'schema'],
      relations: ['api>writes>schema', 'api>migrates>schema'],
      conceptIds: ['topic.models', 'pg.table'],
    });
  },
};

const layered: Template = {
  id: 'rnp.layered-api',
  code: 'T2',
  version: '1.0.0',
  name: 'Layered Node API',
  category: 'backend',
  summary:
    'Each entity gets a route handler, a use case and a repository. Requests go down the layers, never around them.',
  whenToUse: [
    'CRUD-heavy APIs with some business rules.',
    'Teams that want one obvious place for each kind of code.',
  ],
  whenNotToUse: [
    'The business rules are complex and change often (use the hexagonal template).',
    'A thin proxy with no rules of its own.',
  ],
  tradeoffs: [
    'Easy to learn and to navigate.',
    'Use cases can depend on the ORM types, so the database leaks upwards unless you are strict.',
  ],
  parameters: [
    { key: 'serviceName', label: 'Service name', type: 'string', default: 'Orders API' },
    {
      key: 'entities',
      label: 'Entities',
      type: 'string[]',
      default: ['Order', 'Customer'],
      max: 4,
      help: 'One route handler, use case, repository and table per entity.',
    },
  ],
  rulePacks: ['core', 'layered', 'security', 'api'],
  invariants: [
    'A node.route-handler in {serviceName} MUST call a node.use-case, never a repository or the database.',
    'Only node.repository code MAY import the database client.',
    'Each of {entities} has exactly one repository.',
  ],
  folderLayout: {
    'node.route-handler': 'src/http/**',
    'node.use-case': 'src/application/**',
    'node.repository': 'src/repositories/**',
  },
  learnId: 'pattern.layered',
  build(p, b) {
    const entities = list(p.entities);
    b.el('client', 'gen.actor', 'API client', { x: 0, y: 60 });
    b.el('svc', 'node.service', str(p.serviceName), {
      x: 120,
      y: 0,
      properties: { framework: 'express', transport: ['rest'], dataAccess: 'prisma' },
    });
    authMiddleware(b, 'auth', 'svc', IN.x, IN.y);
    const serviceWidth = IN.x + 3 * M + 2 * GAP + 16;
    b.el('db', 'pg.database', 'Database', { x: 120 + serviceWidth + 80, y: 0 });
    b.el('schema', 'pg.schema', 'app', { parent: 'db', ...IN });
    entities.forEach((entity, i) => {
      const y = IN.y + (i + 1) * (MH + GAP);
      const table = tableName(entity);
      b.el(`ctl${i}`, 'node.route-handler', `${entity} routes`, {
        parent: 'svc',
        x: IN.x,
        y,
        layer: 'presentation',
        properties: { routes: [`/${table.replace(/_/g, '-')}`], validation: 'zod' },
      });
      b.el(`uc${i}`, 'node.use-case', `${entity} service`, {
        parent: 'svc',
        x: IN.x + M + GAP,
        y,
        layer: 'application',
      });
      b.el(`repo${i}`, 'node.repository', `${entity} repository`, {
        parent: 'svc',
        x: IN.x + 2 * (M + GAP),
        y,
        layer: 'infrastructure',
        properties: { dataAccess: 'prisma' },
      });
      b.el(`tbl${i}`, 'pg.table', table, {
        parent: 'schema',
        x: IN.x,
        y: IN.y + i * (80 + 16),
        properties: entityTable(),
      });
      b.rel(`ctl${i}`, 'calls', `uc${i}`);
      b.rel(`uc${i}`, 'calls', `repo${i}`);
      b.rel(`repo${i}`, 'reads', `tbl${i}`, { via: 'prisma' });
      b.rel(`repo${i}`, 'writes', `tbl${i}`, { via: 'prisma' });
    });
    b.rel('client', 'calls', 'svc', { protocol: 'http' });
    b.rel('svc', 'migrates', 'schema');
    b.step({
      title: 'Three layers',
      body: 'Route handlers turn HTTP into calls, use cases hold the rules, repositories talk to the database.',
      elements: ['ctl0', 'uc0', 'repo0'],
      conceptIds: ['topic.models'],
    });
    b.step({
      title: 'One way down',
      body: 'A request goes handler → use case → repository → table. A handler that queries the database itself skips the rules (RNP-005).',
      relations: ['ctl0>calls>uc0', 'uc0>calls>repo0', 'repo0>writes>tbl0'],
    });
    b.step({
      title: 'Tables per entity',
      body: 'Each of {entities} has its own table and its own repository, so database code for one entity lives in one place.',
      elements: ['schema'],
      conceptIds: ['pg.table'],
    });
  },
};

const hexagonal: Template = {
  id: 'rnp.hexagonal-service',
  code: 'T3',
  version: '1.0.0',
  name: 'Hexagonal Node service',
  category: 'backend',
  summary:
    'The domain is in the middle and depends on nothing. Use cases call ports (interfaces); adapters implement them for HTTP and the database.',
  whenToUse: [
    'Business rules that are complex, important, and need fast tests.',
    'You expect to replace the database library or add other entry points (queues, CLI).',
  ],
  whenNotToUse: ['Simple CRUD: the extra interfaces cost more than they give.'],
  tradeoffs: [
    'The domain is tested without a database or HTTP.',
    'More files and indirection; new developers need the map.',
  ],
  parameters: [
    { key: 'serviceName', label: 'Service name', type: 'string', default: 'Orders' },
    { key: 'aggregate', label: 'Aggregate', type: 'string', default: 'Order' },
    {
      key: 'orm',
      label: 'Database library',
      type: 'enum',
      options: ['prisma', 'drizzle', 'kysely'],
      default: 'prisma',
    },
  ],
  rulePacks: ['core', 'hexagonal', 'security'],
  invariants: [
    '`services/{serviceName:slug}/src/domain` MUST NOT import @prisma/client, drizzle-orm, kysely, express or any adapter.',
    'Persistence MUST go through a node.port; node.repository implements it.',
    'node.route-handler MUST call a node.use-case, never a node.repository.',
  ],
  folderLayout: {
    'node.domain': 'services/{serviceName:slug}/src/domain/**',
    'node.use-case': 'services/{serviceName:slug}/src/application/**',
    'node.port': 'services/{serviceName:slug}/src/domain/ports/**',
    'node.repository': 'services/{serviceName:slug}/src/adapters/db/**',
    'node.route-handler': 'services/{serviceName:slug}/src/adapters/http/**',
  },
  learnId: 'pattern.hexagonal',
  build(p, b) {
    const agg = str(p.aggregate);
    const orm = str(p.orm);
    b.el('client', 'gen.actor', 'API client', { x: 0, y: 120 });
    b.el('svc', 'node.service', str(p.serviceName), {
      x: 120,
      y: 0,
      properties: { framework: 'fastify', transport: ['rest'], dataAccess: orm },
    });
    authMiddleware(b, 'auth', 'svc', IN.x, IN.y);
    // Driving side on the left, the core in the middle, the driven side on the right.
    const row = IN.y + MH + GAP;
    const col = (i: number) => IN.x + i * (M + GAP);
    b.el('http', 'node.route-handler', `${agg} HTTP adapter`, {
      parent: 'svc',
      x: col(0),
      y: row,
      properties: { validation: 'zod' },
    });
    b.el('uc', 'node.use-case', `Place ${agg.toLowerCase()}`, { parent: 'svc', x: col(1), y: row });
    b.el('port', 'node.port', `${agg} repository port`, {
      parent: 'svc',
      x: col(2) + (M - 56) / 2,
      y: row + 4,
    });
    b.el('repo', 'node.repository', `${agg} repository (${orm})`, {
      parent: 'svc',
      x: col(3),
      y: row,
      properties: { dataAccess: orm },
    });
    b.el('domain', 'node.domain', agg, {
      parent: 'svc',
      x: col(1) + 10,
      y: row + MH + GAP,
      responsibilities: [`Keep ${agg.toLowerCase()} totals and states valid`],
    });
    b.el('db', 'pg.database', 'Database', { x: 120 + col(4) + 120, y: 0 });
    b.el('schema', 'pg.schema', slugify(str(p.serviceName)).replace(/-/g, '_'), {
      parent: 'db',
      ...IN,
    });
    b.el('table', 'pg.table', tableName(agg), {
      parent: 'schema',
      ...IN,
      properties: entityTable([
        { name: 'status', type: 'text', nullable: false },
        { name: 'total_cents', type: 'bigint', nullable: false },
        { name: 'version', type: 'integer', nullable: false },
      ]),
    });
    b.rel('client', 'calls', 'svc', { protocol: 'http' });
    b.rel('http', 'calls', 'uc');
    b.rel('uc', 'depends-on', 'domain');
    b.rel('uc', 'uses-port', 'port');
    b.rel('repo', 'implements', 'port');
    b.rel('repo', 'reads', 'table', { via: orm });
    b.rel('repo', 'writes', 'table', { via: orm });
    b.rel('svc', 'migrates', 'schema');
    b.step({
      title: 'The domain in the middle',
      body: 'The {aggregate} domain model holds the rules and imports nothing: no ORM, no HTTP.',
      elements: ['domain'],
      conceptIds: ['topic.models'],
    });
    b.step({
      title: 'Ports and adapters',
      body: 'The use case asks for a port (an interface). The repository adapter implements it with {orm}. Tests use an in-memory adapter instead.',
      elements: ['port', 'repo'],
      relations: ['uc>uses-port>port', 'repo>implements>port'],
    });
    b.step({
      title: 'Entry point',
      body: 'The HTTP adapter validates input and calls the use case. Other entry points (a queue, a CLI) would call the same use case.',
      elements: ['http', 'uc'],
      relations: ['http>calls>uc'],
    });
  },
};

const modularMonolith: Template = {
  id: 'rnp.modular-monolith',
  code: 'T4',
  version: '1.0.0',
  name: 'NestJS modular monolith',
  category: 'backend',
  summary:
    'One deployable split into modules. Each module owns its own schema and offers a public API; other modules never touch its tables.',
  whenToUse: [
    'Several teams or areas in one product, without the cost of microservices.',
    'A first step before splitting services out later.',
  ],
  whenNotToUse: ['Parts must scale or deploy on their own schedule today.'],
  tradeoffs: [
    'One deploy and real transactions, with boundaries you can enforce.',
    'Boundaries only hold if they are checked (see the modular-monolith rules and dependency-cruiser).',
  ],
  parameters: [
    { key: 'appName', label: 'App name', type: 'string', default: 'Shop' },
    {
      key: 'modules',
      label: 'Modules',
      type: 'string[]',
      default: ['Orders', 'Catalog', 'Billing'],
      max: 6,
    },
  ],
  rulePacks: ['core', 'modular-monolith', 'security'],
  invariants: [
    'Each of {modules} MUST only write its own schema.',
    'A module MUST use another module only through its exported service, never its repositories or tables.',
  ],
  folderLayout: { 'node.module': 'src/modules/**' },
  learnId: 'pattern.modular-monolith',
  build(p, b) {
    const modules = list(p.modules);
    b.el('client', 'gen.actor', 'API client', { x: 0, y: 60 });
    b.el('app', 'node.service', str(p.appName), {
      x: 120,
      y: 0,
      properties: { framework: 'nestjs', transport: ['rest'], dataAccess: 'prisma' },
    });
    authMiddleware(b, 'auth', 'app', IN.x, IN.y);
    // The first module on the left; the modules it works with in a column on the right.
    const right = IN.x + M + 2 * GAP;
    const rowY = (i: number) => IN.y + i * (MH + GAP);
    const modulePos = (i: number) =>
      i === 0 ? { x: IN.x, y: rowY(1) } : { x: right, y: rowY(i - 1) };
    const appWidth = (modules.length > 1 ? right + M : IN.x + M) + 16;
    b.el('db', 'pg.database', `${str(p.appName)} DB`, { x: 120 + appWidth + 140, y: 0 });
    // Schemas in the same order as the modules on the right, the first module's last.
    const schemaRow = (i: number) => (i === 0 ? modules.length - 1 : i - 1);
    modules.forEach((name, i) => {
      const slug = slugify(name);
      const mod = b.el(`mod${i}`, 'node.module', name, {
        parent: 'app',
        ...modulePos(i),
        properties: { exports: [`${name.replace(/\W/g, '')}Service`] },
      });
      b.el(`schema${i}`, 'pg.schema', slug.replace(/-/g, '_'), {
        parent: 'db',
        x: IN.x,
        y: IN.y + schemaRow(i) * (90 + 24),
        // Records the owning module; RNP-028 checks it.
        properties: { ownedBy: name },
      });
      b.rel(mod, 'writes', `schema${i}`, { via: 'prisma' });
      b.rel('app', 'migrates', `schema${i}`);
    });
    // The first module uses the second; the others use the first (for example Billing reads
    // order totals through the Orders module).
    if (modules.length > 1) b.rel('mod0', 'depends-on', 'mod1', { label: 'public API' });
    for (let i = 2; i < modules.length; i++)
      b.rel(`mod${i}`, 'depends-on', 'mod0', { label: 'public API' });
    b.rel('client', 'calls', 'app', { protocol: 'http' });
    b.step({
      title: 'One deployable, many modules',
      body: '{appName} runs as one process. Inside, {modules} are separate modules with clear owners.',
      elements: ['app'],
    });
    b.step({
      title: 'Each module owns its schema',
      body: 'A module reads and writes only its own schema. Reaching into another module’s tables is reported (RNP-028).',
      elements: ['db'],
      relations: ['mod0>writes>schema0'],
      conceptIds: ['pg.table'],
    });
    b.step({
      title: 'Talk through public APIs',
      body: 'Modules call each other through exported services, so a module can later move into its own service.',
      elements: ['mod0'],
    });
  },
};

const bff: Template = {
  id: 'rnp.bff',
  code: 'T5',
  version: '1.0.0',
  name: 'React + Node backend-for-frontend',
  category: 'fullstack',
  summary:
    'The React app talks to one Node BFF. The BFF holds the session, combines calls to the backend services, and shapes data for the screens.',
  whenToUse: [
    'The frontend needs data from several backend services.',
    'You want tokens out of the browser (the BFF keeps them server-side).',
  ],
  whenNotToUse: ['There is only one backend service: the BFF adds a hop for nothing.'],
  tradeoffs: [
    'One request per screen, and backend changes stay hidden from the app.',
    'One more service to run; it must not grow business rules of its own.',
  ],
  parameters: [
    { key: 'appName', label: 'App name', type: 'string', default: 'Web' },
    {
      key: 'services',
      label: 'Backend services',
      type: 'string[]',
      default: ['Orders', 'Catalog'],
      max: 5,
    },
  ],
  rulePacks: ['core', 'microservices', 'frontend', 'security'],
  invariants: [
    'The {appName} app MUST call only the BFF.',
    'The BFF MUST NOT write any database; {services} own their data.',
    'Session tokens MUST stay in the BFF; the browser gets an HttpOnly cookie.',
  ],
  learnId: 'pattern.bff',
  build(p, b) {
    const services = list(p.services);
    b.el('user', 'gen.actor', 'Customer', { x: 0, y: 40 });
    b.el('app', 'react.app', str(p.appName), {
      x: 120,
      y: 20,
      properties: { bundler: 'vite', tokenStorage: 'http-only-cookie' },
    });
    b.el('bff', 'node.bff', `${str(p.appName)} BFF`, {
      x: 340,
      y: 0,
      properties: { framework: 'fastify', client: str(p.appName) },
    });
    authMiddleware(b, 'auth', 'bff', IN.x, IN.y);
    b.el('db', 'pg.database', 'Services DB', { x: 860, y: 0 });
    services.forEach((name, i) => {
      b.el(`svc${i}`, 'node.service', `${name} service`, {
        x: 600,
        y: i * (80 + 40),
        properties: { framework: 'fastify', dataAccess: 'prisma' },
      });
      b.el(`schema${i}`, 'pg.schema', slugify(name).replace(/-/g, '_'), {
        parent: 'db',
        x: IN.x,
        y: IN.y + i * (90 + 32),
      });
      b.rel('bff', 'calls', `svc${i}`, { protocol: 'http' });
      b.rel(`svc${i}`, 'reads', `schema${i}`, { via: 'prisma' });
      b.rel(`svc${i}`, 'writes', `schema${i}`, { via: 'prisma' });
      b.rel(`svc${i}`, 'migrates', `schema${i}`);
    });
    b.rel('user', 'calls', 'app', { label: 'uses' });
    b.rel('app', 'calls', 'bff', { protocol: 'http', label: 'one call per screen' });
    b.step({
      title: 'One door for the app',
      body: 'The {appName} app only knows its BFF. It makes one request per screen.',
      elements: ['app', 'bff'],
      relations: ['app>calls>bff'],
    });
    b.step({
      title: 'The BFF holds the session',
      body: 'The browser gets an HttpOnly cookie; the BFF keeps the tokens and checks them in its auth middleware.',
      elements: ['auth'],
      conceptIds: ['topic.authentication'],
    });
    b.step({
      title: 'Services own their data',
      body: 'Each of {services} has its own schema. The BFF reads nothing directly; it calls the services.',
      elements: ['db'],
    });
  },
};

const dbPerService: Template = {
  id: 'rnp.db-per-service',
  code: 'T6',
  version: '1.0.0',
  name: 'Node services, database per service',
  category: 'backend',
  summary:
    'A gateway in front of independent services. Each service has its own database on a shared PostgreSQL server; slow or follow-up work goes through a job queue.',
  whenToUse: [
    'Teams that must deploy and scale their service on their own.',
    'Clear business areas with little shared data.',
  ],
  whenNotToUse: [
    'One small team: a modular monolith is cheaper.',
    'Most features need data from several services in one transaction.',
  ],
  tradeoffs: [
    'Independent deploys, failures and scaling.',
    'No joins or transactions across services; data is copied with events, and is eventually consistent.',
  ],
  parameters: [
    {
      key: 'services',
      label: 'Services',
      type: 'string[]',
      default: ['Orders', 'Payments', 'Shipping'],
      max: 5,
    },
    {
      key: 'gateway',
      label: 'Gateway',
      type: 'enum',
      options: ['nginx', 'kong', 'traefik', 'cloud'],
      default: 'nginx',
    },
  ],
  rulePacks: ['core', 'microservices', 'event-driven', 'security'],
  invariants: [
    'Each of {services} MUST only connect to its own database.',
    'Services MUST NOT call each other in a cycle; follow-up work goes through the job queue.',
    'All external traffic MUST pass the gateway, which checks tokens.',
  ],
  learnId: 'pattern.database-per-service',
  build(p, b) {
    const services = list(p.services);
    const rowY = (i: number) => IN.y + i * 150;
    b.el('client', 'gen.actor', 'Client', { x: 0, y: rowY(0) + 10 });
    b.el('gw', 'gen.gateway', 'API gateway', {
      x: 120,
      y: rowY(0),
      properties: { product: str(p.gateway) },
      tech: str(p.gateway),
    });
    b.el('idp', 'gen.auth-provider', 'Identity provider', { x: 125, y: rowY(1) + 40 });
    b.el('cluster', 'pg.cluster', 'PostgreSQL server', { x: 600, y: 0 });
    services.forEach((name, i) => {
      b.el(`svc${i}`, 'node.service', `${name} service`, {
        x: 320,
        y: rowY(i) + 5,
        properties: { framework: 'fastify', dataAccess: 'prisma' },
      });
      b.el(`db${i}`, 'pg.database', `${name} DB`, { parent: 'cluster', x: IN.x, y: rowY(i) });
      b.rel('gw', 'calls', `svc${i}`, { protocol: 'http' });
      b.rel(`svc${i}`, 'reads', `db${i}`, { via: 'prisma' });
      b.rel(`svc${i}`, 'writes', `db${i}`, { via: 'prisma' });
      b.rel(`svc${i}`, 'migrates', `db${i}`);
    });
    if (services.length > 1) {
      b.el('jobs', 'pg.job-queue', `${services[0]} jobs`, {
        parent: 'db0',
        ...IN,
        properties: { lib: 'pg-boss', deadLetter: true },
      });
      b.rel('svc0', 'enqueues', 'jobs', { inTransaction: true });
      b.rel('svc1', 'processes', 'jobs');
    }
    b.rel('client', 'calls', 'gw', { protocol: 'http' });
    b.rel('gw', 'authenticates-with', 'idp');
    b.step({
      title: 'The gateway',
      body: 'All traffic enters through the gateway, which checks tokens with the identity provider and routes to the services.',
      elements: ['gw', 'idp'],
      conceptIds: ['topic.authentication'],
    });
    b.step({
      title: 'A database per service',
      body: 'Each service has its own database on one PostgreSQL server. Nobody else connects to it.',
      elements: ['cluster'],
    });
    if (services.length > 1)
      b.step({
        title: 'Work between services',
        body: 'Instead of calling the next service and waiting, the first service enqueues a job in the same transaction as its data. The other service processes it.',
        elements: ['jobs'],
        relations: ['svc0>enqueues>jobs', 'svc1>processes>jobs'],
        conceptIds: ['topic.transactions-and-isolation'],
      });
  },
};

const backgroundJobs: Template = {
  id: 'rnp.background-jobs',
  code: 'T7',
  version: '1.0.0',
  name: 'Background jobs on PostgreSQL',
  category: 'backend',
  summary:
    'The API saves the request and enqueues a job in the same transaction. A worker process runs slow or failure-prone work, with retries.',
  whenToUse: [
    'E-mails, PDFs, imports, calls to slow partners: anything the user should not wait for.',
    'You already run PostgreSQL and do not want another broker.',
  ],
  whenNotToUse: ['Thousands of jobs per second: use a dedicated broker.'],
  tradeoffs: [
    'Jobs commit or roll back with the data: no lost or ghost jobs.',
    'The database also carries the queue load; watch its size and vacuum.',
  ],
  parameters: [
    { key: 'apiName', label: 'API name', type: 'string', default: 'Shop API' },
    {
      key: 'jobs',
      label: 'Jobs',
      type: 'string[]',
      default: ['Send confirmation email', 'Generate invoice PDF'],
      max: 5,
    },
    {
      key: 'lib',
      label: 'Job library',
      type: 'enum',
      options: ['pg-boss', 'graphile-worker'],
      default: 'pg-boss',
    },
  ],
  rulePacks: ['core', 'event-driven', 'concurrency', 'security'],
  invariants: [
    'Jobs MUST be enqueued in the same transaction as the data they belong to.',
    'Job handlers MUST be idempotent: a job can run more than once.',
    'Jobs that keep failing MUST move to a dead-letter queue after the last retry.',
  ],
  learnId: 'pattern.background-jobs',
  build(p, b) {
    const lib = str(p.lib);
    const jobs = list(p.jobs);
    b.el('user', 'gen.actor', 'Customer', { x: 0, y: 80 });
    b.el('api', 'node.service', str(p.apiName), {
      x: 120,
      y: 0,
      properties: { framework: 'express', dataAccess: 'prisma' },
    });
    authMiddleware(b, 'auth', 'api', IN.x, IN.y);
    b.el('routes', 'node.route-handler', 'Order routes', {
      parent: 'api',
      x: IN.x,
      y: IN.y + MH + GAP,
      properties: { validation: 'zod', routes: ['POST /orders'] },
    });
    b.el('uc', 'node.use-case', 'Place order', {
      parent: 'api',
      x: IN.x + M + GAP,
      y: IN.y + MH + GAP,
    });
    b.el('db', 'pg.database', 'Shop DB', { x: 520, y: 0 });
    b.el('schema', 'pg.schema', 'public', { parent: 'db', ...IN });
    b.el('queue', 'pg.job-queue', 'jobs', {
      parent: 'db',
      x: IN.x,
      y: IN.y + 90 + 32,
      properties: { lib, queues: jobs.map(slugify), deadLetter: true },
    });
    b.el('worker', 'node.worker', 'Worker', {
      x: 760,
      y: 120,
      responsibilities: jobs,
      properties: { jobLib: lib, concurrency: 5 },
    });
    b.el('ext', 'gen.external', 'E-mail provider', { x: 760, y: 280 });
    b.rel('user', 'calls', 'api', { protocol: 'http' });
    b.rel('routes', 'calls', 'uc');
    b.rel('uc', 'writes', 'schema', { via: 'prisma' });
    b.rel('uc', 'enqueues', 'queue', { inTransaction: true });
    b.rel('worker', 'processes', 'queue');
    b.rel('worker', 'reads', 'schema', { via: 'prisma' });
    b.rel('worker', 'calls', 'ext', {
      protocol: 'http',
      properties: { retries: 3, timeoutMs: 10000 },
    });
    b.rel('api', 'migrates', 'schema');
    b.step({
      title: 'Answer fast',
      body: '"Place order" saves the order and enqueues the jobs in one transaction, then answers. The customer never waits for {jobs}.',
      elements: ['uc', 'queue'],
      relations: ['uc>enqueues>queue'],
      conceptIds: ['topic.transactions-and-isolation'],
    });
    b.step({
      title: 'The worker',
      body: 'A separate process takes jobs from the queue ({lib}), retries failures, and moves jobs that keep failing to a dead-letter queue.',
      elements: ['worker'],
      relations: ['worker>processes>queue'],
      conceptIds: ['topic.event-loop-and-parallelism'],
    });
  },
};

const FSD_LAYERS = ['pages', 'widgets', 'features', 'entities', 'shared'] as const;

const featureSliced: Template = {
  id: 'rnp.fsd-app',
  code: 'T11',
  version: '1.0.0',
  name: 'Feature-Sliced React app',
  category: 'frontend',
  summary:
    'The React code is split into layers (pages, widgets, features, entities, shared) and slices. Code only imports from layers below it.',
  whenToUse: ['A React app that several people work on and that keeps growing.'],
  whenNotToUse: ['A small app with a handful of screens.'],
  tradeoffs: [
    'Clear places for code, and features that can be removed without breaking others.',
    'Takes discipline to decide what is a feature and what is an entity.',
  ],
  parameters: [
    { key: 'appName', label: 'App name', type: 'string', default: 'Web' },
    {
      key: 'features',
      label: 'Features',
      type: 'string[]',
      default: ['Cart', 'Checkout', 'Search'],
      max: 5,
    },
  ],
  rulePacks: ['frontend', 'fsd'],
  invariants: [
    'Code MUST only import from layers below its own: pages → widgets → features → entities → shared.',
    'Features ({features}) MUST NOT import each other.',
  ],
  folderLayout: { 'react.feature': 'src/**' },
  learnId: 'pattern.feature-sliced',
  build(p, b) {
    const features = list(p.features);
    const slices: Record<(typeof FSD_LAYERS)[number], string[]> = {
      pages: ['Home page'],
      widgets: ['Storefront'],
      features,
      entities: ['User', 'Product'],
      shared: ['UI kit'],
    };
    b.el('app', 'react.app', str(p.appName), {
      x: 0,
      y: 0,
      properties: { bundler: 'vite', router: 'react-router' },
    });
    const widest = Math.max(...Object.values(slices).map((s) => s.length));
    const layerWidth = 16 + widest * (M + 16);
    FSD_LAYERS.forEach((layer, i) => {
      b.el(`layer-${layer}`, 'group.layer', layer, {
        parent: 'app',
        x: IN.x,
        y: IN.y + i * (160 + 24),
      });
      slices[layer].forEach((name, j) => {
        b.el(`${layer}${j}`, 'react.feature', name, {
          parent: `layer-${layer}`,
          x: 16 + j * (M + 16),
          y: IN.y,
          properties: { fsdLayer: layer, folder: `src/${layer}/${slugify(name)}` },
        });
      });
    });
    // Entities load data through the shared API client and keep it in the server-state cache.
    const side = IN.x + layerWidth + 60;
    b.el('api', 'react.api-client', 'API client', {
      parent: 'app',
      x: side,
      y: IN.y + 3 * (160 + 24) + IN.y,
      properties: { kind: 'fetch' },
    });
    b.el('cache', 'react.server-state', 'Server-state cache', {
      parent: 'app',
      x: side + 15,
      y: IN.y + 4 * (160 + 24) + IN.y - 4,
      properties: { lib: 'tanstack-query' },
    });
    b.rel('pages0', 'depends-on', 'widgets0');
    features.forEach((_, j) => {
      b.rel('widgets0', 'depends-on', `features${j}`);
      b.rel(`features${j}`, 'depends-on', `entities${j % 2}`);
    });
    b.rel('entities0', 'depends-on', 'shared0');
    b.rel('entities1', 'depends-on', 'shared0');
    b.rel('entities1', 'fetches-via', 'api');
    b.rel('entities0', 'fetches-via', 'api');
    b.rel('entities1', 'uses-state', 'cache');
    b.step({
      title: 'Layers',
      body: 'From top to bottom: pages, widgets, features, entities, shared. Code imports only downwards.',
      elements: ['layer-pages', 'layer-shared'],
    });
    b.step({
      title: 'Features stay apart',
      body: '{features} never import each other. A widget or a page composes them; what they share moves down to an entity.',
      elements: ['layer-features'],
      relations: ['widgets0>depends-on>features0'],
      conceptIds: ['react.server-state'],
    });
  },
};

export const TEMPLATES: Template[] = [
  starter,
  layered,
  hexagonal,
  modularMonolith,
  bff,
  dbPerService,
  backgroundJobs,
  featureSliced,
];
