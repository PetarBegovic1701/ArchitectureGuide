import pg from 'pg';
import type { Evidence, Fact } from '@archguide/core';
import { DATABASE, schemaSubject, tableSubject } from './detectors/pg';

/** Runs one catalog query and returns its rows. */
export type CatalogQuery = (sql: string) => Promise<Record<string, unknown>[]>;

/** Schemas of PostgreSQL and of tools (job queues, migration journals): not part of the model. */
const SKIP_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'pgboss',
  'graphile_worker',
  'graphile_migrate',
  'drizzle',
];
const SKIP_TABLES = [
  '_prisma_migrations',
  'pgmigrations',
  'knex_migrations',
  'knex_migrations_lock',
  'typeorm_migrations',
  'migrations',
  'schema_migrations',
];
const notInternal = (col: string) =>
  `${col} NOT IN (${SKIP_SCHEMAS.map((s) => `'${s}'`).join(', ')}) AND ${col} NOT LIKE 'pg_temp_%' AND ${col} NOT LIKE 'pg_toast_temp_%'`;

/** Column names of a key, in key order (pg_constraint.conkey / pg_index.indkey). */
const keyColumns = (keys: string, rel: string) =>
  `(SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(${keys}) WITH ORDINALITY AS k(attnum, ord) JOIN pg_catalog.pg_attribute a ON a.attrelid = ${rel} AND a.attnum = k.attnum)`;

/** The catalog queries (§19.7): `pg_catalog`, not `information_schema` (R8); no table data. */
export const CATALOG_SQL = {
  database: `SELECT current_database() AS name, current_setting('server_version') AS version`,
  extensions: `SELECT extname AS name FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`,
  schemas: `SELECT n.nspname AS schema FROM pg_catalog.pg_namespace n WHERE ${notInternal('n.nspname')} ORDER BY 1`,
  tables: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.relrowsecurity AS rls
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm') AND ${notInternal('n.nspname')} ORDER BY 1, 2`,
  columns: `SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p') AND ${notInternal('n.nspname')}
    ORDER BY 1, 2, a.attnum`,
  constraints: `SELECT n.nspname AS schema, c.relname AS table, con.contype AS type,
      ${keyColumns('con.conkey', 'con.conrelid')} AS columns,
      fn.nspname AS ref_schema, fc.relname AS ref_table, ${keyColumns('con.confkey', 'con.confrelid')} AS ref_columns
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
    WHERE con.contype IN ('p', 'f', 'u') AND ${notInternal('n.nspname')} ORDER BY 1, 2, con.conname`,
  indexes: `SELECT n.nspname AS schema, t.relname AS table, ix.indisunique AS unique,
      ${keyColumns('ix.indkey::int2[]', 't.oid')} AS columns
    FROM pg_catalog.pg_index ix
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE ${notInternal('n.nspname')} ORDER BY 1, 2`,
} as const;

const arr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map(String)
    : typeof v === 'string'
      ? v
          .replace(/^\{|\}$/g, '')
          .split(',')
          .filter(Boolean)
      : [];
const bool = (v: unknown) => v === true || v === 't' || v === 'true';

/** Turns catalog rows into facts, with the same subjects the code detectors use. */
export async function introspectionFacts(query: CatalogQuery): Promise<Fact[]> {
  const [db] = await query(CATALOG_SQL.database);
  const name = String(db?.name ?? 'database');
  const ev = (symbol?: string): Evidence[] => [
    { path: `postgres://${name}`, ...(symbol ? { symbol } : {}), detector: 'pg.introspect' },
  ];
  const extensions = (await query(CATALOG_SQL.extensions)).map((r) => String(r.name));
  const facts: Fact[] = [
    {
      type: 'db-database',
      subject: DATABASE,
      data: { name, version: db?.version },
      evidence: ev(),
      confidence: 0.95,
      detector: 'pg.introspect',
      element: {
        kind: 'pg.database',
        name,
        ...(extensions.length ? { properties: { extensions } } : {}),
      },
    },
  ];
  const tables = (await query(CATALOG_SQL.tables)).filter(
    (t) => !SKIP_TABLES.includes(String(t.name)),
  );
  const columns = await query(CATALOG_SQL.columns);
  const constraints = await query(CATALOG_SQL.constraints);
  const indexes = await query(CATALOG_SQL.indexes);
  for (const s of await query(CATALOG_SQL.schemas)) {
    const schema = String(s.schema);
    const own = tables.filter((t) => t.schema === schema);
    // Empty schemas (public in a fresh database) are left out.
    if (!own.length) continue;
    const rls = own.some((t) => bool(t.rls));
    facts.push({
      type: 'db-schema',
      subject: schemaSubject(schema),
      data: { schema },
      evidence: ev(schema),
      confidence: 0.95,
      detector: 'pg.introspect',
      element: {
        kind: 'pg.schema',
        name: schema,
        parent: DATABASE,
        ...(rls ? { properties: { rls: true } } : {}),
      },
    });
  }
  for (const t of tables) {
    const [schema, table] = [String(t.schema), String(t.name)];
    const subject = tableSubject(schema, table);
    const view = t.kind === 'v' || t.kind === 'm';
    const of = <T extends Record<string, unknown>>(rows: T[]) =>
      rows.filter((r) => r.schema === schema && r.table === table);
    const cons = of(constraints);
    const pk = cons.find((c) => c.type === 'p');
    const fks = cons
      .filter((c) => c.type === 'f')
      .map((c) => ({
        columns: arr(c.columns),
        references: `${String(c.ref_schema)}.${String(c.ref_table)}`,
        refColumns: arr(c.ref_columns),
      }));
    const idx = of(indexes).map((i) => ({
      columns: arr(i.columns),
      ...(bool(i.unique) ? { unique: true } : {}),
    }));
    facts.push({
      type: 'db-table',
      subject,
      data: { schema, table, rls: bool(t.rls) },
      evidence: ev(`${schema}.${table}`),
      confidence: 0.95,
      detector: 'pg.introspect',
      element: {
        kind: view ? 'pg.view' : 'pg.table',
        name: table,
        parent: schemaSubject(schema),
        ...(view
          ? { properties: { materialized: t.kind === 'm' } }
          : {
              properties: {
                columns: of(columns).map((c) => ({
                  name: String(c.name),
                  type: String(c.type),
                  ...(bool(c.nullable) ? { nullable: true } : {}),
                })),
                ...(pk ? { primaryKey: arr(pk.columns) } : {}),
                ...(fks.length ? { foreignKeys: fks } : {}),
                ...(idx.length ? { indexes: idx } : {}),
              },
            }),
      },
    });
    for (const fk of fks)
      facts.push({
        type: 'db-fk',
        subject: `${subject}:fk:${fk.columns.join(',')}`,
        data: { table: subject, columns: fk.columns, references: fk.references },
        evidence: ev(`${schema}.${table}`),
        confidence: 0.95,
        detector: 'pg.introspect',
      });
    for (const i of idx)
      facts.push({
        type: 'db-index',
        subject: `${subject}:ix:${i.columns.join(',')}`,
        data: { table: subject, columns: i.columns },
        evidence: ev(`${schema}.${table}`),
        confidence: 0.95,
        detector: 'pg.introspect',
      });
  }
  return facts;
}

/**
 * Live introspection (Implementation.md §19.7): a read-only connection, the catalog queries,
 * then the connection is closed. The URL comes from the environment and is never stored.
 */
export async function introspectDatabase(options: {
  url: string;
  timeoutMs?: number;
}): Promise<Fact[]> {
  const client = new pg.Client({
    connectionString: options.url,
    statement_timeout: options.timeoutMs ?? 10_000,
  });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    await client.query('BEGIN READ ONLY');
    const facts = await introspectionFacts(
      async (sql) => (await client.query(sql)).rows as Record<string, unknown>[],
    );
    await client.query('ROLLBACK');
    return facts;
  } finally {
    await client.end();
  }
}
