import { posix } from 'node:path';
import type { Fact } from '@archguide/core';
import type { Detector, DetectorContext } from '../context';
import { at } from '../context';
import type { FileIndex } from '../engines/ts-index';
import { callOf, obj, ref, text } from '../engines/ts-index';
import { codeFiles, deployablesFor, hasDep, title } from './util';

export const DATABASE = 'db:main';
export const schemaSubject = (schema: string) => `schema:${schema}`;
export const tableSubject = (schema: string, table: string) => `table:${schema}.${table}`;

/**
 * The repository's name, for the database: package.json `name`, a root pyproject.toml
 * `[project] name`, the .NET solution file, else the folder.
 */
async function repositoryName(ctx: DetectorContext): Promise<string> {
  if (ctx.engines.repo.files.includes('package.json'))
    try {
      const root = JSON.parse((await ctx.engines.read('package.json')) ?? '{}') as {
        name?: string;
      };
      if (root.name) return root.name;
    } catch {
      // not JSON: try the other manifests
    }
  if (ctx.engines.repo.files.includes('pyproject.toml')) {
    const text = (await ctx.engines.read('pyproject.toml')) ?? '';
    const name = /^\[project\][^[]*?^name\s*=\s*["']([^"']+)["']/ms.exec(text)?.[1];
    if (name) return name;
  }
  const sln = ctx.engines.repo.files.find((f) => !f.includes('/') && f.endsWith('.sln'));
  if (sln) return posix.basename(sln, '.sln');
  return posix.basename(ctx.root);
}

export async function databaseFact(
  ctx: DetectorContext,
  evidence: Fact['evidence'],
  detector: string,
): Promise<Fact> {
  const name = await repositoryName(ctx);
  return {
    type: 'db-database',
    subject: DATABASE,
    data: {},
    evidence,
    confidence: 0.8,
    detector,
    element: { kind: 'pg.database', name: `${title(name)} DB` },
  };
}

export const schemaFact = (
  schema: string,
  evidence: Fact['evidence'],
  detector: string,
  extra: Record<string, unknown> = {},
): Fact => ({
  type: 'db-schema',
  subject: schemaSubject(schema),
  data: { schema, ...extra },
  evidence,
  confidence: 0.85,
  detector,
  element: {
    kind: 'pg.schema',
    name: schema,
    parent: DATABASE,
    ...(Object.keys(extra).length ? { properties: extra } : {}),
  },
});

export interface TableShape {
  schema: string;
  table: string;
  model?: string;
  columns: { name: string; type: string }[];
  primaryKey: string[];
  foreignKeys: { columns: string[]; references: string; refColumns: string[]; line: number }[];
  indexes: { columns: string[]; unique?: boolean; line: number }[];
  file: string;
  line: number;
  view?: boolean;
}

/** db-table, db-fk and db-index facts for one table shape. */
export function tableFacts(t: TableShape, detector: string, confidence = 0.9): Fact[] {
  const subject = tableSubject(t.schema, t.table);
  const out: Fact[] = [
    {
      type: 'db-table',
      subject,
      data: { schema: t.schema, table: t.table, ...(t.model ? { model: t.model } : {}) },
      evidence: [at(t.file, t.line, t.model ?? t.table)],
      confidence,
      detector,
      element: {
        kind: t.view ? 'pg.view' : 'pg.table',
        name: t.table,
        parent: schemaSubject(t.schema),
        ...(t.view
          ? {}
          : {
              properties: {
                columns: t.columns,
                ...(t.primaryKey.length ? { primaryKey: t.primaryKey } : {}),
                ...(t.foreignKeys.length
                  ? {
                      foreignKeys: t.foreignKeys.map((f) => ({
                        columns: f.columns,
                        references: f.references,
                        refColumns: f.refColumns,
                      })),
                    }
                  : {}),
                ...(t.indexes.length
                  ? {
                      indexes: t.indexes.map((i) => ({
                        columns: i.columns,
                        ...(i.unique ? { unique: true } : {}),
                      })),
                    }
                  : {}),
              },
            }),
      },
    },
  ];
  for (const fk of t.foreignKeys)
    out.push({
      type: 'db-fk',
      subject: `${subject}:fk:${fk.columns.join(',')}`,
      data: { table: subject, columns: fk.columns, references: fk.references },
      evidence: [at(t.file, fk.line)],
      confidence,
      detector,
    });
  for (const ix of t.indexes)
    out.push({
      type: 'db-index',
      subject: `${subject}:ix:${ix.columns.join(',')}`,
      data: { table: subject, columns: ix.columns },
      evidence: [at(t.file, ix.line)],
      confidence,
      detector,
    });
  return out;
}

/** `pg.prisma-schema`: models, @@map, @@schema, relations and indexes of schema.prisma. */
const prismaSchema: Detector = {
  id: 'pg.prisma-schema',
  appliesTo: (p) => hasDep(p, 'prisma', '@prisma/client'),
  async run(ctx) {
    const out: Fact[] = [];
    for (const file of ctx.files.filter((f) => f.endsWith('.prisma'))) {
      const schema = await ctx.engines.prisma(file);
      if (!schema || (schema.provider && !/postgres/.test(schema.provider))) continue;
      out.push(await databaseFact(ctx, [at(file, 1, 'datasource')], 'pg.prisma-schema'));
      const used = new Set(schema.models.map((m) => m.schema));
      for (const s of used)
        out.push(
          schemaFact(s, [at(file, 1)], 'pg.prisma-schema', { migrationTool: 'prisma-migrate' }),
        );
      const byName = new Map(schema.models.map((m) => [m.name, m]));
      for (const m of schema.models) {
        const scalar = m.fields.filter(
          (f) => !byName.has(f.type) && !schema.enums.includes(f.type) && !f.list,
        );
        const fks = m.fields
          .filter((f) => f.relation)
          .map((f) => {
            const target = byName.get(f.type);
            const columns = f.relation!.fields.map(
              (x) => m.fields.find((y) => y.name === x)?.column ?? x,
            );
            return {
              columns,
              references: target ? `${target.schema}.${target.table}` : f.type,
              refColumns: f.relation!.references.map(
                (x) => target?.fields.find((y) => y.name === x)?.column ?? x,
              ),
              line: f.line,
            };
          });
        const indexes = [
          ...m.indexes.map((cols) => ({
            columns: cols.map((x) => m.fields.find((y) => y.name === x)?.column ?? x),
            line: m.line,
          })),
          ...m.fields
            .filter((f) => f.id || f.unique)
            .map((f) => ({ columns: [f.column ?? f.name], unique: true, line: f.line })),
        ];
        out.push(
          ...tableFacts(
            {
              schema: m.schema,
              table: m.table,
              model: m.name,
              columns: scalar.map((f) => ({ name: f.column ?? f.name, type: f.type })),
              primaryKey: m.fields.filter((f) => f.id).map((f) => f.column ?? f.name),
              foreignKeys: fks,
              indexes,
              file,
              line: m.line,
              view: m.view,
            },
            'pg.prisma-schema',
          ),
        );
      }
    }
    return out;
  },
};

/** `pg.drizzle-schema`: `pgTable(` and `pgSchema(…).table(` calls. */
const drizzleSchema: Detector = {
  id: 'pg.drizzle-schema',
  appliesTo: (p) => hasDep(p, 'drizzle-orm'),
  async run(ctx) {
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index?.imports.some((i) => i.specifier.startsWith('drizzle-orm/pg-core'))) continue;
      const schemas = new Map<string, string>();
      for (const c of index.calls)
        if (c.callee === 'pgSchema' && c.in && typeof c.args[0] === 'string')
          schemas.set(c.in, c.args[0]);
      const tables = index.calls
        .filter(
          (c) =>
            c.callee === 'pgTable' ||
            (/^(\w+)\.table$/.test(c.callee) && schemas.has(c.callee.split('.')[0]!)),
        )
        .sort((a, b) => a.line - b.line);
      if (tables.length)
        out.push(await databaseFact(ctx, [at(f, tables[0]!.line)], 'pg.drizzle-schema'));
      for (const s of new Set([
        ...schemas.values(),
        ...(tables.some((t) => t.callee === 'pgTable') ? ['public'] : []),
      ]))
        out.push(
          schemaFact(
            s,
            [at(f, index.calls.find((c) => c.callee === 'pgSchema' && c.args[0] === s)?.line ?? 1)],
            'pg.drizzle-schema',
            { migrationTool: 'drizzle-kit' },
          ),
        );
      tables.forEach((t, i) => {
        const name = typeof t.args[0] === 'string' ? t.args[0] : undefined;
        if (!name) return;
        const schema = t.callee === 'pgTable' ? 'public' : schemas.get(t.callee.split('.')[0]!)!;
        const cols = obj(t.args[1]) ?? {};
        const end = tables[i + 1]?.line ?? Infinity;
        const fks = Object.entries(cols)
          .filter(([, v]) => /\.references$/.test(callOf(v) ?? ''))
          .map(([k]) => ({ columns: [k], references: '?', refColumns: [], line: t.line }));
        const indexes = index.calls
          .filter(
            (c) =>
              c.line >= t.line &&
              c.line < end &&
              /^(index|uniqueIndex|primaryKey|unique)\.on$|^(index|uniqueIndex)\.on$/.test(
                c.callee,
              ),
          )
          .map((c) => ({
            columns: c.args.flatMap((a) => (ref(a) ? [ref(a)!.split('.').pop()!] : [])),
            line: c.line,
          }));
        const pk = Object.entries(cols)
          .filter(([, v]) => /\.primaryKey$/.test(callOf(v) ?? ''))
          .map(([k]) => k);
        out.push(
          ...tableFacts(
            {
              schema,
              table: name,
              ...(t.in ? { model: t.in } : {}),
              columns: Object.entries(cols).map(([k, v]) => ({
                name: k,
                type: callOf(v)?.split('.')[0] ?? 'unknown',
              })),
              primaryKey: pk,
              foreignKeys: fks,
              indexes: [
                ...indexes,
                ...pk.map((k) => ({ columns: [k], unique: true, line: t.line })),
              ],
              file: f,
              line: t.line,
            },
            'pg.drizzle-schema',
          ),
        );
      });
    }
    return out;
  },
};

/** `pg.typeorm`: `@Entity` classes with their columns, relations and indexes. */
const typeorm: Detector = {
  id: 'pg.typeorm',
  appliesTo: (p) => hasDep(p, 'typeorm'),
  async run(ctx) {
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const e of index.decorators.filter(
        (d) => d.name === 'Entity' && d.targetKind === 'class',
      )) {
        const o = obj(e.args[0]);
        const table = (typeof e.args[0] === 'string' ? e.args[0] : text(o?.name)) ?? e.target;
        const schema = text(o?.schema) ?? 'public';
        const props = index.decorators.filter(
          (d) => d.className === e.target && d.targetKind === 'property',
        );
        const columns = props.filter((d) => /Column$/.test(d.name)).map((d) => d.target);
        const pk = props
          .filter((d) => /^Primary(Generated)?Column$/.test(d.name))
          .map((d) => d.target);
        const fks = props
          .filter((d) => d.name === 'JoinColumn')
          .map((d) => ({
            columns: [text(obj(d.args[0])?.name) ?? `${d.target}Id`],
            references: '?',
            refColumns: [],
            line: d.line,
          }));
        const indexes = index.decorators
          .filter((d) => d.name === 'Index' && (d.target === e.target || d.className === e.target))
          .map((d) => ({
            columns: Array.isArray(d.args[0])
              ? d.args[0].map(String)
              : d.targetKind === 'property'
                ? [d.target]
                : [],
            line: d.line,
          }));
        out.push(await databaseFact(ctx, [at(f, e.line)], 'pg.typeorm'));
        out.push(schemaFact(schema, [at(f, e.line)], 'pg.typeorm', { migrationTool: 'typeorm' }));
        out.push(
          ...tableFacts(
            {
              schema,
              table,
              model: e.target,
              columns: columns.map((name) => ({ name, type: 'unknown' })),
              primaryKey: pk,
              foreignKeys: fks,
              indexes: [
                ...indexes,
                ...pk.map((c) => ({ columns: [c], unique: true, line: e.line })),
              ],
              file: f,
              line: e.line,
            },
            'pg.typeorm',
          ),
        );
      }
    }
    return out;
  },
};

/** `pg.sql`: `CREATE SCHEMA / TABLE / INDEX` in .sql files, parsed by the PostgreSQL parser. */
const sql: Detector = {
  id: 'pg.sql',
  async run(ctx) {
    const files = ctx.files.filter((f) => f.endsWith('.sql'));
    if (!files.length) return [];
    const out: Fact[] = [];
    const shapes = new Map<string, TableShape>();
    const fks: {
      key: string;
      columns: string[];
      references: string;
      refColumns: string[];
      file: string;
      line: number;
    }[] = [];
    const indexes: {
      key: string;
      columns: string[];
      unique: boolean;
      file: string;
      line: number;
    }[] = [];
    for (const f of files) {
      const r = await ctx.engines.sql(f);
      if (!r) continue;
      for (const s of r.schemas) out.push(schemaFact(s.name, [at(f, s.line)], 'pg.sql'));
      for (const t of r.tables)
        shapes.set(`${t.schema}.${t.name}`, {
          schema: t.schema,
          table: t.name,
          columns: t.columns.map((name) => ({ name, type: t.types[name] ?? 'unknown' })),
          primaryKey: t.primaryKey,
          foreignKeys: [],
          indexes: [],
          file: f,
          line: t.line,
        });
      for (const k of r.foreignKeys)
        fks.push({
          key: `${k.schema}.${k.table}`,
          columns: k.columns,
          references: `${k.refSchema}.${k.refTable}`,
          refColumns: k.refColumns,
          file: f,
          line: k.line,
        });
      for (const i of r.indexes)
        indexes.push({
          key: `${i.schema}.${i.table}`,
          columns: i.columns,
          unique: i.unique,
          file: f,
          line: i.line,
        });
    }
    if (!shapes.size) return out;
    out.push(await databaseFact(ctx, [at(files[0]!, 1)], 'pg.sql'));
    for (const t of shapes.values())
      if (!out.some((o) => o.subject === schemaSubject(t.schema)))
        out.push(schemaFact(t.schema, [at(t.file, t.line)], 'pg.sql'));
    for (const [key, t] of shapes) {
      t.foreignKeys = fks
        .filter((k) => k.key === key)
        .map((k) => ({
          columns: k.columns,
          references: k.references,
          refColumns: k.refColumns,
          line: k.line,
        }));
      t.indexes = indexes
        .filter((i) => i.key === key)
        .map((i) => ({ columns: i.columns, unique: i.unique, line: i.line }));
      // Facts for indexes and keys point at the file that declares them.
      const facts = tableFacts(t, 'pg.sql', 0.85);
      for (const x of facts) {
        if (x.type === 'db-fk')
          x.evidence = [
            at(
              fks.find(
                (k) =>
                  k.key === key && k.columns.join(',') === (x.data.columns as string[]).join(','),
              )!.file,
              x.evidence[0]!.line,
            ),
          ];
        if (x.type === 'db-index')
          x.evidence = [
            at(
              indexes.find(
                (i) =>
                  i.key === key && i.columns.join(',') === (x.data.columns as string[]).join(','),
              )?.file ?? t.file,
              x.evidence[0]!.line,
            ),
          ];
      }
      out.push(...facts);
    }
    return out;
  },
};

const MIGRATION_DIRS: [RegExp, string][] = [
  [/(^|\/)prisma\/migrations\//, 'prisma'],
  [/(^|\/)drizzle\//, 'drizzle'],
  [/(^|\/)supabase\/migrations\//, 'supabase'],
  [/(^|\/)(db\/)?migrations\//, 'migrations'],
];

/** `pg.migrations`: the package whose migrations create or change which tables. */
const migrations: Detector = {
  id: 'pg.migrations',
  async run(ctx) {
    const groups = new Map<string, string[]>();
    for (const f of ctx.files) {
      const m = MIGRATION_DIRS.find(([re]) => re.test(f));
      if (m && /\.(sql|[jt]s)$/.test(f)) groups.set(m[1], [...(groups.get(m[1]) ?? []), f]);
    }
    if (!groups.size) return [];
    const out: Fact[] = [];
    for (const [tool0, files] of groups) {
      const tool =
        tool0 === 'migrations'
          ? (['node-pg-migrate', 'knex', 'typeorm', 'kysely', 'umzug'].find((d) =>
              ctx.pkg.deps.has(d),
            ) ?? 'sql')
          : tool0;
      const tables = new Set<string>();
      const schemas = new Set<string>();
      for (const f of files) {
        if (f.endsWith('.sql')) {
          const r = await ctx.engines.sql(f);
          for (const t of r?.touched ?? []) tables.add(t);
          for (const s of r?.schemas ?? []) schemas.add(schemaSubject(s.name));
        } else {
          const index = await ctx.engines.index(f);
          for (const c of index?.calls ?? []) {
            if (/\.(createTable|alterTable|dropTable|createTableIfNotExists)$/.test(c.callee)) {
              const name = text(c.args[0]) ?? text(obj(c.args[0])?.name);
              if (name) tables.add(name.includes('.') ? name : `public.${name}`);
            }
            if (/\.query$/.test(c.callee)) {
              const q = text(c.args[0]) ?? '';
              for (const m of q.matchAll(
                /\b(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?(\w+)"?(?:\."?(\w+)"?)?/gi,
              ))
                tables.add(m[2] ? `${m[1]}.${m[2]}` : `public.${m[1]}`);
            }
          }
        }
      }
      // Prisma migrations change the schemas of the Prisma models.
      const base = ctx.pkg.dir ? `${ctx.pkg.dir}/` : '';
      if (tool === 'prisma')
        for (const f of ctx.facts)
          if (
            f.type === 'db-schema' &&
            f.detector === 'pg.prisma-schema' &&
            f.evidence.some((e) => e.path.startsWith(base))
          )
            schemas.add(f.subject);
      out.push({
        type: 'migrations',
        subject: `migrations:${ctx.pkgSubject(ctx.pkg)}:${tool}`,
        data: {
          deployable: ctx.pkgSubject(ctx.pkg),
          tool,
          tables: [...tables].sort(),
          schemas: [...schemas].sort(),
        },
        evidence: files.slice(0, 5).map((f) => at(f, 1)),
        confidence: 0.9,
        detector: 'pg.migrations',
      });
    }
    return out;
  },
};

const PRISMA_READ = /^(find\w*|count|aggregate|groupBy)$/;
const PRISMA_WRITE = /^(create\w*|update\w*|upsert|delete\w*)$/;

/** Which tables a file reads and writes, per ORM (§19.4 `pg.orm-usage`). */
export function ormUsages(
  index: FileIndex,
): { target: string; op: 'read' | 'write'; orm: string; line: number }[] {
  const out: { target: string; op: 'read' | 'write'; orm: string; line: number }[] = [];
  const prisma =
    index.imports.some((i) => /@prisma\/client|\/db$|\/prisma$|\.\/db|prisma/.test(i.specifier)) ||
    index.calls.some((c) => /\$transaction$/.test(c.callee));
  for (const c of index.calls) {
    const p = /(?:^|\.)(prisma|tx|trx|db|client)\.(\w+)\.(\w+)$/.exec(c.callee);
    if (
      prisma &&
      p &&
      !p[2]!.startsWith('$') &&
      (PRISMA_READ.test(p[3]!) || PRISMA_WRITE.test(p[3]!))
    )
      out.push({
        target: p[2]!,
        op: PRISMA_WRITE.test(p[3]!) ? 'write' : 'read',
        orm: 'prisma',
        line: c.line,
      });
    const drizzleRead = /(?:^|\.)(db|tx|trx|database)\.(select|selectDistinct)\.from$/.test(
      c.callee,
    );
    const drizzleWrite = /(?:^|\.)(db|tx|trx|database)\.(insert|update|delete)$/.test(c.callee);
    if ((drizzleRead || drizzleWrite) && ref(c.args[0]))
      out.push({
        target: ref(c.args[0])!.split('.').pop()!,
        op: drizzleWrite ? 'write' : 'read',
        orm: 'drizzle',
        line: c.line,
      });
    const relational = /(?:^|\.)(db|tx)\.query\.(\w+)\.(findMany|findFirst)$/.exec(c.callee);
    if (relational) out.push({ target: relational[2]!, op: 'read', orm: 'drizzle', line: c.line });
    const kysely = /\.(selectFrom|insertInto|updateTable|deleteFrom)$/.exec(c.callee);
    if (kysely && typeof c.args[0] === 'string')
      out.push({
        target: c.args[0].split(' ')[0]!,
        op: kysely[1] === 'selectFrom' ? 'read' : 'write',
        orm: 'kysely',
        line: c.line,
      });
    if (/\.(getRepository|getCustomRepository)$|^getRepository$/.test(c.callee) && ref(c.args[0]))
      out.push({
        target: ref(c.args[0])!,
        op: index.calls.some((x) =>
          /\.(save|insert|update|delete|remove|softDelete)$/.test(x.callee),
        )
          ? 'write'
          : 'read',
        orm: 'typeorm',
        line: c.line,
      });
    if (/(^|\.)(query|execute|sql)$/.test(c.callee)) {
      const q = text(c.args[0]);
      if (!q) continue;
      const write = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?(?:\."?(\w+)"?)?/i.exec(q);
      const read = /\bSELECT\b[\s\S]*?\bFROM\s+"?(\w+)"?(?:\."?(\w+)"?)?/i.exec(q);
      const m = write ?? read;
      if (m)
        out.push({
          target: m[2] ? `${m[1]}.${m[2]}` : m[1]!,
          op: write ? 'write' : 'read',
          orm: 'sql',
          line: c.line,
        });
    }
  }
  for (const d of index.decorators)
    if (d.name === 'InjectRepository' && ref(d.args[0]))
      out.push({
        target: ref(d.args[0])!,
        op: index.calls.some((x) => /\.(save|insert|update|delete|remove)$/.test(x.callee))
          ? 'write'
          : 'read',
        orm: 'typeorm',
        line: d.line,
      });
  return out;
}

/** `pg.orm-usage`: reads and writes per deployable, for the data ownership map. */
const ormUsage: Detector = {
  id: 'pg.orm-usage',
  appliesTo: (p) =>
    hasDep(
      p,
      '@prisma/client',
      'drizzle-orm',
      'typeorm',
      'kysely',
      'pg',
      'postgres',
      '@nestjs/typeorm',
    ),
  async run(ctx) {
    const owners = deployablesFor(ctx, ctx.pkg);
    if (!owners.length) return [];
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      if (!index) continue;
      for (const u of ormUsages(index))
        for (const deployable of owners)
          out.push({
            type: 'orm-usage',
            subject: `use:${deployable}:${f}:${u.line}:${u.target}`,
            data: { deployable, target: u.target, op: u.op, orm: u.orm, file: f },
            evidence: [at(f, u.line, `${u.target} (${u.op})`)],
            confidence: 0.8,
            detector: 'pg.orm-usage',
          });
    }
    return out;
  },
};

/**
 * `pg.jobs` (repository scope): pg-boss `send` / `work` / `schedule`, graphile-worker
 * `addJob` / task lists. Enqueues inside a transaction callback get `inTransaction`.
 */
const jobs: Detector = {
  id: 'pg.jobs',
  scope: 'repo',
  async run(ctx) {
    const out: Fact[] = [];
    const queues = new Map<
      string,
      { lib: string; names: Set<string>; evidence: Fact['evidence'] }
    >();
    const deployables = new Set(
      ctx.facts.filter((f) => f.type === 'deployable').map((f) => f.subject),
    );
    for (const p of ctx.packages) {
      const lib = p.deps.has('pg-boss')
        ? 'pg-boss'
        : p.deps.has('graphile-worker')
          ? 'graphile-worker'
          : undefined;
      if (!lib) continue;
      const owners = deployables.has(ctx.pkgSubject(p))
        ? [ctx.pkgSubject(p)]
        : ctx.packages
            .filter((q) => q.deps.has(p.name) && deployables.has(ctx.pkgSubject(q)))
            .map((q) => ctx.pkgSubject(q));
      const base = p.dir ? `${p.dir}/` : '';
      const subject = `queue:${lib}`;
      const q = queues.get(subject) ?? { lib, names: new Set(), evidence: [] };
      queues.set(subject, q);
      for (const f of ctx.files.filter(
        (x) => x.startsWith(base) && /\.(m|c)?[jt]s$/.test(x) && !x.endsWith('.d.ts'),
      )) {
        const index = await ctx.engines.index(f);
        if (!index) continue;
        const bosses = new Set([
          'boss',
          'pgBoss',
          'queue',
          'jobs',
          ...Object.entries(index.bindings)
            .filter(([, c]) => c === 'PgBoss')
            .map(([n]) => n),
        ]);
        for (const c of index.calls) {
          const m = /(?:^|\.)(\w+)\.(send|sendAfter|insert|schedule|work)$/.exec(c.callee);
          const pgBoss = lib === 'pg-boss' && m && bosses.has(m[1]!);
          const graphileAdd =
            lib === 'graphile-worker' && /(^|\.)(addJob|quickAddJob)$/.test(c.callee);
          const graphileRun = lib === 'graphile-worker' && c.callee === 'run';
          let name: string | undefined;
          let role: 'producer' | 'consumer' | undefined;
          if (pgBoss) {
            name = text(c.args[0]);
            role = m![2] === 'work' ? 'consumer' : 'producer';
          } else if (graphileAdd) {
            name = text(c.callee.endsWith('quickAddJob') ? c.args[1] : c.args[0]);
            role = 'producer';
          } else if (graphileRun) {
            for (const n of Object.keys(obj(obj(c.args[0])?.taskList) ?? {})) q.names.add(n);
            role = 'consumer';
          }
          if (!role) continue;
          if (name) q.names.add(name);
          q.evidence.push(at(f, c.line, c.callee));
          const inTransaction = c.inside.some((x) =>
            /(\$transaction|\.transaction|^transaction)$/.test(x),
          );
          for (const owner of owners)
            out.push({
              type: role === 'producer' ? 'job-producer' : 'job-consumer',
              subject: `${role}:${owner}:${f}:${c.line}`,
              data: { deployable: owner, queue: name ?? null, lib, inTransaction },
              evidence: [at(f, c.line, name ?? c.callee)],
              confidence: 0.85,
              detector: 'pg.jobs',
              relation: {
                type: role === 'producer' ? 'enqueues' : 'processes',
                from: owner,
                to: subject,
                ...(name ? { label: name } : {}),
                ...(role === 'producer' && inTransaction ? { inTransaction: true } : {}),
              },
            });
        }
      }
    }
    for (const [subject, q] of queues)
      if (q.evidence.length)
        out.push({
          type: 'job-queue',
          subject,
          data: { lib: q.lib, queues: [...q.names].sort() },
          evidence: q.evidence.slice(0, 6),
          confidence: 0.85,
          detector: 'pg.jobs',
          element: {
            kind: 'pg.job-queue',
            name: 'Job queue',
            parent: DATABASE,
            properties: { lib: q.lib, queues: [...q.names].sort() },
          },
        });
    return out;
  },
};

/** `pg.notify`: LISTEN / NOTIFY / pg_notify in code. */
const notify: Detector = {
  id: 'pg.notify',
  appliesTo: (p) => hasDep(p, 'pg', 'postgres', '@prisma/client', 'drizzle-orm', 'kysely'),
  async run(ctx) {
    const owners = deployablesFor(ctx, ctx.pkg);
    const out: Fact[] = [];
    for (const f of codeFiles(ctx)) {
      const index = await ctx.engines.index(f);
      for (const c of index?.calls ?? []) {
        const q = text(c.args[0]) ?? '';
        const listen = /^\s*LISTEN\s+"?(\w+)"?/i.exec(q);
        const send = /^\s*NOTIFY\s+"?(\w+)"?|pg_notify\(\s*'(\w+)'/i.exec(q);
        const m = listen ?? send;
        if (!m || !/(query|execute|\$executeRaw|\$queryRaw|sql)$/.test(c.callee)) continue;
        const channel = m[1] ?? m[2]!;
        const subject = `channel:${channel}`;
        out.push({
          type: listen ? 'listen' : 'notify',
          subject,
          data: { channel },
          evidence: [at(f, c.line, channel)],
          confidence: 0.85,
          detector: 'pg.notify',
          element: { kind: 'pg.channel', name: channel, parent: DATABASE, properties: { channel } },
        });
        for (const owner of owners)
          out.push({
            type: listen ? 'listen' : 'notify',
            subject: `${owner}:${listen ? 'listens' : 'notifies'}:${channel}`,
            data: { channel, deployable: owner },
            evidence: [at(f, c.line, channel)],
            confidence: 0.85,
            detector: 'pg.notify',
            relation: { type: listen ? 'listens' : 'notifies', from: owner, to: subject },
          });
      }
    }
    return out;
  },
};

export const PG_DETECTORS: Detector[] = [
  prismaSchema,
  drizzleSchema,
  typeorm,
  sql,
  migrations,
  ormUsage,
  jobs,
  notify,
];
