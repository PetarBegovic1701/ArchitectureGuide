---
id: node.repository
kind: concept
title: Repository / data access
summary: The code that reads and writes the database through an ORM or query builder (Prisma, Drizzle, Kysely), so the rest of the app does not write SQL.
level: beginner
tracks: [data-and-models]
tags: [prisma, drizzle, kysely, orm, sql]
related: [pg.table, pg.schema, node.port, reads, writes, topic.transactions-and-isolation]
references:
  - title: Martin Fowler — Repository
    url: https://martinfowler.com/eaaCatalog/repository.html
  - title: Prisma — Transactions
    url: https://www.prisma.io/docs/orm/prisma-client/queries/transactions
---

## Beginner

A **repository** is the part of the backend that talks to the database. The rest of the
code asks it for things in plain words — `orders.findById(id)`, `orders.save(order)` —
and does not need to know SQL or table names.

It usually uses an ORM or query builder: Prisma, Drizzle, Kysely, TypeORM.

## Intermediate

- One repository per aggregate or table group (orders, products).
- Pass the transaction in (`tx`) so a use case can make several calls atomic.
- Watch for **N+1 queries**: loading 50 orders, then each order's lines one by one.
  Load them together (`include`, a join, or `WHERE id = ANY($1)`).
- Paginate list queries.

## Senior

- Contended writes need a strategy: `SELECT … FOR UPDATE`, a version column, or an atomic
  `UPDATE … SET stock = stock - $1 WHERE stock >= $1`. The concurrency lab shows why.
- Keep ORM types inside the repository; return domain objects or DTOs.
- Know the SQL your ORM generates; check plans (`EXPLAIN ANALYZE`) for hot queries.

## Common mistakes

- N+1 queries.
- Read-modify-write without concurrency control (lost updates).
- ORM entities leaking into HTTP responses.

## Examples

**An atomic stock update instead of read-then-write:**

```ts
const updated = await db
  .updateTable('products')
  .set((eb) => ({ stock: eb('stock', '-', quantity) }))
  .where('id', '=', productId)
  .where('stock', '>=', quantity)
  .executeTakeFirst();
if (Number(updated.numUpdatedRows) === 0) throw new OutOfStock(productId);
```
