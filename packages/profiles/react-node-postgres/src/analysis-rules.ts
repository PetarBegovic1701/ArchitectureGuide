import type { AnalysisContext, AnalysisRule, Evidence, Fact } from '@archguide/core';
import { RULES } from './rules';

/**
 * Analysis-scope rules (Implementation.md §11.6, scope "analysis"): they read the facts the
 * analyzer found in the code, so every finding points at files and lines. Rules that are
 * model rules too share their ID, title and learning text.
 */

const model = (id: string) => RULES.find((r) => r.id === id);
const shared = (
  id: string,
  fallback: Pick<AnalysisRule, 'title' | 'rationale'> & { learnId?: string },
) => {
  const r = model(id);
  return {
    title: r?.title ?? fallback.title,
    rationale: r?.rationale ?? fallback.rationale,
    ...((r?.learnId ?? fallback.learnId) ? { learnId: r?.learnId ?? fallback.learnId } : {}),
  };
};

const nameOf = (ctx: AnalysisContext, subject: string) => {
  const id = ctx.idOf(subject);
  return ctx.candidates.elements.find((e) => e.id === id)?.name ?? subject.replace(/^\w+:/, '');
};
const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const evidenceOf = (facts: readonly Fact[]): Evidence[] => facts.flatMap((f) => f.evidence);

const sharedTables: AnalysisRule = {
  id: 'RNP-001',
  severity: 'warning',
  ...shared('RNP-001', { title: 'Shared tables between services', rationale: '' }),
  check: (ctx) =>
    Object.entries(ctx.ownership.schemas).flatMap(([schema]) => {
      const tables = Object.entries(ctx.ownership.tables).filter(([, t]) => t.schema === schema);
      const writers = [...new Set(tables.flatMap(([, t]) => t.writers.map((w) => w.deployable)))];
      if (writers.length < 2) return [];
      const written = tables.filter(([, t]) => t.writers.length).map(([id]) => ctx.idOf(id));
      return [
        {
          targetIds: [ctx.idOf(schema)],
          relatedIds: [...writers.map((w) => ctx.idOf(w)), ...written],
          message: `The code of ${list(writers.map((w) => nameOf(ctx, w)))} writes schema ${nameOf(ctx, schema)} (${list(
            tables.filter(([, t]) => t.writers.length > 0).map(([id]) => nameOf(ctx, id)),
          )}). Pick one owner; the others go through its API or events.`,
          evidence: tables.flatMap(([, t]) => t.writers.flatMap((w) => w.evidence)),
        },
      ];
    }),
};

const migrationOwners: AnalysisRule = {
  id: 'RNP-002',
  severity: 'error',
  ...shared('RNP-002', { title: 'Several migration owners', rationale: '' }),
  check: (ctx) =>
    Object.entries(ctx.ownership.schemas)
      .filter(([, s]) => s.owners.length > 1)
      .map(([schema, s]) => ({
        targetIds: [ctx.idOf(schema)],
        relatedIds: s.owners.map((o) => ctx.idOf(o.deployable)),
        message: `The migrations of ${list(s.owners.map((o) => nameOf(ctx, o.deployable)))} all change schema ${nameOf(
          ctx,
          schema,
        )}. One package owns the migrations of a schema; the others read through a view or an API.`,
        evidence: s.owners.flatMap((o) => o.evidence),
      })),
};

const dbClientInBrowser: AnalysisRule = {
  id: 'RNP-003',
  title: 'Database client in the frontend bundle',
  severity: 'error',
  learnId: 'react.app',
  rationale:
    'Code in the browser is public: anyone can read it and call what it calls. A database client there means database credentials in the bundle, or a database open to the internet. The browser talks to a Node.js API; only types and validation schemas (zod) are shared.',
  check: (ctx) =>
    ctx
      .of('import-violation')
      .filter((f) => f.data.rule === 'RNP-003')
      .map((f) => {
        const chain = (f.data.chain as string[]) ?? [];
        return {
          targetIds: [ctx.idOf(String(f.data.app))],
          message: `${nameOf(ctx, String(f.data.app))} bundles the database client "${String(f.data.external)}"${
            chain.length > 1 ? ` (through ${chain.join(' → ')})` : ` in ${String(f.data.file)}`
          }. Move the query to the API and call it over HTTP.`,
          evidence: f.evidence,
        };
      }),
};

const browserSecrets: AnalysisRule = {
  id: 'RNP-004',
  title: 'Secrets exposed to the browser',
  severity: 'error',
  learnId: 'topic.authentication',
  rationale:
    'Bundlers copy `VITE_*`, `REACT_APP_*` and `NEXT_PUBLIC_*` variables into the JavaScript every visitor downloads. A password, a token or a database URL there is public. Keep secrets in the server environment and add an endpoint that does the work.',
  check: (ctx) =>
    ctx
      .of('env-var')
      .filter((f) => f.data.browser && f.data.sensitive)
      .map((f) => ({
        targetIds: [f.data.package ? ctx.idOf(String(f.data.package)) : String(f.data.file)],
        message: `${String(f.data.name)} in ${String(f.data.file)} is sent to every browser. Move it to the server's environment.`,
        evidence: f.evidence,
      })),
};

const ORM_LIBS = new Set([
  '@prisma/client',
  'drizzle-orm',
  'typeorm',
  'knex',
  'kysely',
  'sequelize',
  '@mikro-orm/core',
  'pg',
  'postgres',
]);

const handlerUsesOrm: AnalysisRule = {
  id: 'RNP-005',
  severity: 'warning',
  ...shared('RNP-005', { title: 'Route handler uses the database directly', rationale: '' }),
  check: (ctx) =>
    ctx.of('handler').flatMap((h) => {
      const file = String(h.data.file);
      const usage = ctx.of('orm-usage').filter((u) => u.data.file === file);
      const imports = ctx
        .of('import')
        .filter(
          (i) => i.data.file === file && ORM_LIBS.has(String(i.data.external)) && !i.data.typeOnly,
        );
      if (!usage.length && !imports.length) return [];
      return [
        {
          targetIds: [ctx.idOf(h.subject)],
          message: `${nameOf(ctx, h.subject)} queries the database itself (${file}). Put a use case and a repository between the route and the ORM.`,
          evidence: [...imports, ...usage].flatMap((f) => f.evidence).slice(0, 5),
        },
      ];
    }),
};

const domainUsesOrm: AnalysisRule = {
  id: 'RNP-006',
  severity: 'warning',
  ...shared('RNP-006', { title: 'Domain depends on the database or framework', rationale: '' }),
  check: (ctx) => {
    const hits = ctx
      .of('import')
      .filter(
        (i) =>
          i.data.style === 'node' &&
          i.data.layer === 'domain' &&
          !i.data.typeOnly &&
          i.data.external,
      );
    const bySubject = new Map<string, Fact[]>();
    for (const h of hits)
      bySubject.set(String(h.data.layerSubject), [
        ...(bySubject.get(String(h.data.layerSubject)) ?? []),
        h,
      ]);
    return [...bySubject].map(([subject, facts]) => ({
      targetIds: [ctx.idOf(subject)],
      message: `The domain code imports ${list([...new Set(facts.map((f) => `"${String(f.data.external)}"`))])}. Keep the domain free of ORMs and web frameworks: add a port and implement it in an adapter.`,
      evidence: evidenceOf(facts),
    }));
  },
};

const serverDataInStore: AnalysisRule = {
  id: 'RNP-012',
  severity: 'info',
  ...shared('RNP-012', { title: 'Server data in the client store', rationale: '' }),
  check: (ctx) => {
    const cache = new Set(
      ctx
        .of('state')
        .filter((f) => f.data.role === 'server-state')
        .map((f) => f.subject.split(':').slice(1, -1).join(':')),
    );
    return ctx
      .of('state')
      .filter(
        (f) =>
          (f.data.role === 'async-thunk' || f.data.role === 'fetch-in-store') &&
          cache.has(String(f.data.app)),
      )
      .map((f) => ({
        targetIds: [ctx.idOf(String(f.data.app))],
        message: `${String(f.data.file)} fetches server data into a client store (${f.data.role === 'async-thunk' ? 'createAsyncThunk' : 'a fetch inside a store action'}), while the app has a server-state cache. Let the query cache hold server data.`,
        evidence: f.evidence,
      }));
  },
};

const fsdDirection: AnalysisRule = {
  id: 'RNP-013',
  severity: 'warning',
  ...shared('RNP-013', { title: 'Feature-Sliced Design layer direction', rationale: '' }),
  check: (ctx) =>
    ctx
      .of('import')
      .filter((i) => i.data.style === 'fsd' && Number(i.data.fromRank) > Number(i.data.toRank))
      .map((i) => ({
        targetIds: [ctx.idOf(String(i.data.package))],
        message: `${String(i.data.file)} (layer ${String(i.data.fromLayer)}) imports from ${String(i.data.toLayer)}, a higher layer. Lower layers must not know higher ones: move the code down, or pass it in through props or slots.`,
        evidence: i.evidence,
      })),
};

const noValidation: AnalysisRule = {
  id: 'RNP-015',
  severity: 'info',
  ...shared('RNP-015', { title: 'No validation at the boundary', rationale: '' }),
  check: (ctx) =>
    ctx
      .of('handler')
      // Only handlers that take a body: POST, PUT and PATCH routes.
      .filter(
        (h) =>
          !h.data.validation &&
          ((h.data.routes as string[]) ?? []).some((r) => /^(POST|PUT|PATCH) /.test(r)),
      )
      .map((h) => ({
        targetIds: [ctx.idOf(h.subject)],
        message: `${nameOf(ctx, h.subject)} accepts request bodies, and no zod, joi, class-validator or type provider is used in ${String(h.data.file)}. Validate input at the boundary.`,
        evidence: h.evidence,
      })),
};

const fkWithoutIndex: AnalysisRule = {
  id: 'RNP-017',
  title: 'Foreign key without an index',
  severity: 'info',
  learnId: 'pg.table',
  rationale:
    'PostgreSQL indexes primary keys, not foreign keys. Joins on the foreign key, and deletes or updates of the referenced row, then scan the whole table. Add an index whose first columns are the foreign key columns.',
  check: (ctx) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const indexes = ctx.of('db-index');
    const seen = new Set<string>();
    return ctx.of('db-fk').flatMap((fk) => {
      const table = String(fk.data.table);
      const cols = (fk.data.columns as string[]).map(norm);
      const key = `${table}:${cols.join(',')}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const covered = indexes.some(
        (i) =>
          i.data.table === table &&
          cols.every((c, n) => norm(String((i.data.columns as string[])[n] ?? '')) === c),
      );
      if (covered) return [];
      return [
        {
          targetIds: [ctx.idOf(table)],
          message: `${nameOf(ctx, table)}.${(fk.data.columns as string[]).join(', ')} references ${String(fk.data.references)} and has no index. Add one: CREATE INDEX ON ${nameOf(ctx, table)} (${(fk.data.columns as string[]).join(', ')});`,
          evidence: fk.evidence,
        },
      ];
    });
  },
};

const moduleCycles: AnalysisRule = {
  id: 'RNP-018',
  title: 'Import cycle between Node modules',
  severity: 'warning',
  learnId: 'node.module',
  rationale:
    'Modules that import each other cannot be understood, tested or split alone, and a change in one ripples into the other. Extract what both need into a third module, or let one of them publish an event the other handles.',
  check: (ctx) => {
    const modules = ctx.candidates.elements.filter(
      (e) => e.kind === 'node.module' && e.codePaths?.length,
    );
    const moduleOf = (file: string) =>
      modules
        .filter((m) => m.codePaths!.some((p) => file === p || file.startsWith(`${p}/`)))
        .sort((a, b) => b.codePaths![0]!.length - a.codePaths![0]!.length)[0];
    return ctx.of('cycle').flatMap((c) => {
      const involved = [
        ...new Set(
          (c.data.files as string[])
            .map(moduleOf)
            .filter((m) => m)
            .map((m) => m!.id),
        ),
      ];
      if (involved.length < 2) return [];
      return [
        {
          targetIds: involved,
          message: `${list(involved.map((id) => modules.find((m) => m.id === id)!.name))} import each other (${(c.data.files as string[]).join(' ↔ ')}). Extract a shared module, or use an event.`,
          evidence: c.evidence,
        },
      ];
    });
  },
};

export const ANALYSIS_RULES: AnalysisRule[] = [
  sharedTables,
  migrationOwners,
  dbClientInBrowser,
  browserSecrets,
  handlerUsesOrm,
  domainUsesOrm,
  serverDataInStore,
  fsdDirection,
  noValidation,
  fkWithoutIndex,
  moduleCycles,
];
