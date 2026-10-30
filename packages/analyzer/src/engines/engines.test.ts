import { describe, expect, it } from 'vitest';
import { parseCompose, parseEnv } from './config';
import { parsePrisma } from './prisma';
import { parseSql } from './sql';
import { indexSource, numbersIn, obj, text } from './ts-index';

describe('TypeScript index', () => {
  const index = indexSource(
    'src/x.ts',
    [
      "import { Router } from 'express';",
      "import type { Request } from 'express';",
      'const router = Router();',
      "router.get('/orders/:id', async () => db.select().from(orders));",
      'export default router;',
      'await prisma.$transaction(async (tx) => {',
      "  await boss.send('mail', { id });",
      '});',
      'app.listen(Number(process.env.PORT ?? 3000));',
      'export const api = axios.create({ baseURL: `${process.env.API_URL}/v1`, timeout: 5 });',
    ].join('\n'),
  );

  it('lists imports, bindings, calls with static arguments and lines', () => {
    expect(index.imports.map((i) => [i.specifier, i.typeOnly, i.line])).toEqual([
      ['express', false, 1],
      ['express', true, 2],
    ]);
    expect(index.bindings.router).toBe('Router');
    expect(index.calls.find((c) => c.callee === 'router.get')).toMatchObject({
      line: 4,
      args: ['/orders/:id', { $fn: true }],
    });
    expect(index.calls.find((c) => c.callee === 'db.select.from')?.args).toEqual([
      { $ref: 'orders' },
    ]);
    expect(index.exports).toEqual(['default', 'api']);
  });

  it('knows which calls sit inside which (transactions)', () => {
    expect(index.calls.find((c) => c.callee === 'boss.send')?.inside).toEqual([
      'prisma.$transaction',
    ]);
  });

  it('keeps both sides of ?? and templates with placeholders', () => {
    expect(numbersIn(index.calls.find((c) => c.callee === 'app.listen')!.args[0])).toEqual([3000]);
    const create = index.calls.find((c) => c.callee === 'axios.create')!;
    expect(text(obj(create.args[0])!.baseURL)).toBe('${process.env.API_URL}/v1');
  });
});

describe('Prisma parser', () => {
  it('reads models, @@map, @@schema, relations and indexes', () => {
    const s = parsePrisma(`
datasource db {
  provider = "postgresql"
  schemas  = ["orders", "billing"]
}
model Order {
  id    String @id // the key
  lines Line[]
  @@map("order")
  @@schema("orders")
}
model Line {
  id      String @id
  orderId String @map("order_id")
  order   Order  @relation(fields: [orderId], references: [id])
  @@index([orderId])
  @@schema("orders")
}
enum Status { NEW DONE }
`);
    expect(s).toMatchObject({
      provider: 'postgresql',
      schemas: ['orders', 'billing'],
      enums: ['Status'],
    });
    expect(s.models.map((m) => [m.name, m.table, m.schema])).toEqual([
      ['Order', 'order', 'orders'],
      ['Line', 'Line', 'orders'],
    ]);
    const line = s.models[1]!;
    expect(line.fields.find((f) => f.name === 'order')?.relation).toEqual({
      fields: ['orderId'],
      references: ['id'],
    });
    expect(line.fields.find((f) => f.name === 'orderId')?.column).toBe('order_id');
    expect(line.indexes).toEqual([['orderId']]);
  });
});

describe('SQL parser (libpg-query)', () => {
  it('reads schemas, tables, keys, indexes and touched tables, with lines', async () => {
    const r = await parseSql(`CREATE SCHEMA billing;

CREATE TABLE billing.invoice (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders."order"(id)
);
CREATE INDEX invoice_order_idx ON billing.invoice (order_id);
ALTER TABLE billing.invoice ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES billing.other(id);
LISTEN invoices;`);
    expect(r.schemas).toEqual([{ name: 'billing', line: 1 }]);
    expect(r.tables[0]).toMatchObject({
      schema: 'billing',
      name: 'invoice',
      line: 3,
      columns: ['id', 'order_id'],
      primaryKey: ['id'],
    });
    expect(r.foreignKeys.map((k) => [k.columns, `${k.refSchema}.${k.refTable}`, k.line])).toEqual([
      [['order_id'], 'orders.order', 3],
      [['id'], 'billing.other', 8],
    ]);
    expect(r.indexes).toContainEqual({
      schema: 'billing',
      table: 'invoice',
      columns: ['order_id'],
      unique: false,
      line: 7,
    });
    expect(r.touched).toEqual(['billing.invoice']);
    expect(r.listens).toEqual([{ channel: 'invoices', line: 9 }]);
  });

  it('reports a parse error instead of failing', async () => {
    expect((await parseSql('CREATE TABLE (')).error).toBeTruthy();
  });
});

describe('compose and env', () => {
  it('keeps names and URL schemes, hosts and ports, never the values', () => {
    const env = parseEnv(
      '.env',
      'DATABASE_URL=postgres://app:hunter2@db:5432/shop\nexport API_KEY="sk-secret"\n# comment\n',
    );
    expect(env).toEqual([
      {
        name: 'DATABASE_URL',
        file: '.env',
        line: 1,
        url: { host: 'db', port: 5432, scheme: 'postgres' },
      },
      { name: 'API_KEY', file: '.env', line: 2 },
    ]);
    const compose = parseCompose(`services:
  api:
    build: ./services/api
    ports: ["3000:3000", "9229"]
    environment:
      - DATABASE_URL=postgres://u:hunter2@db:5432/x
      - TOKEN=abc
    depends_on: [db]
  db:
    image: postgres:16
`);
    expect(compose.services[0]).toMatchObject({
      name: 'api',
      line: 2,
      build: './services/api',
      ports: [{ host: 3000, container: 3000 }, { container: 9229 }],
      environment: ['DATABASE_URL', 'TOKEN'],
      urls: [{ name: 'DATABASE_URL', host: 'db', port: 5432, scheme: 'postgres' }],
      dependsOn: ['db'],
    });
    expect(JSON.stringify([env, compose])).not.toMatch(/hunter2|sk-secret|abc/);
  });
});
