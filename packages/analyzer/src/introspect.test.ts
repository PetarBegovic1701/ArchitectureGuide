import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createCatalog, resolveFacts } from '@archguide/core';
import { profile } from '@archguide/profile-react-node-postgres';
import { introspectionFacts } from './introspect';

describe('live introspection (pg_catalog), against PGlite', () => {
  it('reads schemas, tables, columns, keys, indexes, RLS and extensions, but no rows', async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE SCHEMA billing;
      CREATE TABLE billing.invoice (id uuid PRIMARY KEY, number text NOT NULL UNIQUE, note text);
      CREATE TABLE billing.payment (id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES billing.invoice(id), amount int NOT NULL);
      CREATE INDEX payment_invoice_idx ON billing.payment (invoice_id);
      ALTER TABLE billing.payment ENABLE ROW LEVEL SECURITY;
      CREATE VIEW billing.open_invoice AS SELECT id FROM billing.invoice;
      CREATE TABLE public._prisma_migrations (id text);
      INSERT INTO billing.invoice VALUES ('00000000-0000-0000-0000-000000000001', 'INV-SECRET-ROW', null);
    `);
    const queries: string[] = [];
    const facts = await introspectionFacts(async (sql) => {
      queries.push(sql);
      return (await db.query<Record<string, unknown>>(sql)).rows;
    });
    expect(
      queries.every(
        (q) => /pg_catalog|current_database/.test(q) && !/information_schema\./.test(q),
      ),
    ).toBe(true);
    expect(JSON.stringify(facts)).not.toContain('INV-SECRET-ROW');

    const r = resolveFacts(facts, createCatalog([profile]));
    const byName = (n: string) => r.candidates.elements.find((e) => e.name === n);
    expect(byName('billing')).toMatchObject({ kind: 'pg.schema', properties: { rls: true } });
    expect(
      r.candidates.elements.some((e) => e.name === 'public' || e.name === '_prisma_migrations'),
    ).toBe(false);
    expect(byName('payment')?.properties).toMatchObject({
      primaryKey: ['id'],
      foreignKeys: [{ columns: ['invoice_id'], references: 'billing.invoice', refColumns: ['id'] }],
      indexes: expect.arrayContaining([{ columns: ['invoice_id'] }]),
    });
    expect(byName('invoice')?.properties?.columns).toEqual([
      { name: 'id', type: 'uuid' },
      { name: 'number', type: 'text' },
      { name: 'note', type: 'text', nullable: true },
    ]);
    expect(byName('open_invoice')?.kind).toBe('pg.view');
    expect(r.warnings).toEqual([]);
    expect(facts.filter((f) => f.type === 'db-fk')).toHaveLength(1);
    await db.close();
  });
});
