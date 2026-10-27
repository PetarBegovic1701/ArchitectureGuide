---
id: pg.table
kind: concept
title: Tables and schema design
summary: Tables store your data; keys, constraints and indexes keep it correct and fast.
level: beginner
tracks: [data-and-models]
tags: [postgresql, sql, schema]
related: [pg.schema, pg.function, topic.models, migrates, topic.transactions-and-isolation]
references:
  - title: PostgreSQL docs — Constraints
    url: https://www.postgresql.org/docs/current/ddl-constraints.html
  - title: PostgreSQL docs — Indexes
    url: https://www.postgresql.org/docs/current/indexes.html
  - title: PostgreSQL docs — Data types
    url: https://www.postgresql.org/docs/current/datatype.html
quiz:
  - question: PostgreSQL creates an index automatically for which of these?
    options:
      [
        Every foreign key,
        The primary key and UNIQUE constraints,
        Every column used in WHERE,
        Nothing,
      ]
    answer: 1
    explanation: Primary keys and unique constraints get an index. Foreign key columns do not; add an index when you join or delete by them.
  - question: What type should a price have?
    options: [real, double precision, integer cents or numeric, text]
    answer: 2
    explanation: Floating-point types round (0.1 + 0.2 ≠ 0.3). Use integer cents or numeric.
---

## Beginner

A **table** holds rows of the same kind (orders, customers). Each column has a
**type**. A good table design lets the database refuse wrong data, instead of
hoping every piece of code checks it.

- **Primary key:** a column that identifies each row (`id`). Never reuse or change it.
- **Foreign key:** a column that points at a row in another table
  (`orders.customer_id → customers.id`). The database refuses orders for customers that
  do not exist.
- **NOT NULL, UNIQUE, CHECK:** "this must be filled", "no duplicates", "must be ≥ 0".
- **Index:** a lookup structure that makes searching by a column fast.

A **schema** (in PostgreSQL) is a folder of tables. Change tables only through
**migrations**: small, versioned scripts that every environment runs in order.

## Intermediate

- **Normalize first:** store each fact once (the customer's email lives in `customers`,
  not copied into every order). Denormalize later, on purpose, for read speed.
- **Keys:** `bigint GENERATED ALWAYS AS IDENTITY` is simple and compact; UUIDs (v7 sorts by
  time) help when IDs are created outside the database or must not be guessable.
- **Foreign keys:** choose `ON DELETE` on purpose: `RESTRICT` (default, safest),
  `CASCADE` (delete children), `SET NULL`.
- **Index foreign key columns** you join or filter on; PostgreSQL does not do it for you.
- **Types:** `timestamptz` for points in time, `numeric` or integer cents for money,
  `text` with a `CHECK` (or an enum) for statuses, `jsonb` only for truly flexible data.
- One service owns the migrations of a schema. Other services read through an API or a view.

## Senior

- Constraints are your last line of defense against bugs and races: a `UNIQUE` index on
  `(order_id, idempotency_key)` or `EXCLUDE` constraints for overlapping bookings beat
  any application check.
- Index design follows queries: composite indexes in the order of equality → range
  columns; partial indexes (`WHERE status = 'pending'`) for hot subsets; covering indexes
  (`INCLUDE`) to avoid table lookups. Check with `EXPLAIN (ANALYZE, BUFFERS)`.
- Online migrations on big tables: add columns as nullable first, backfill in batches,
  add `NOT NULL` via a `CHECK ... NOT VALID` + `VALIDATE`, create indexes
  `CONCURRENTLY`, and deploy code that works with both old and new shape (expand → migrate
  → contract).
- Soft deletes and multi-tenancy (tenant_id on every table, RLS) are schema-wide
  decisions; make them early.

## When to use

- One table per kind of thing with its own lifecycle (orders, order_items, customers).

## Common mistakes

- Floats for money.
- `timestamp` without time zone for events.
- No foreign keys "for flexibility".
- Missing indexes on foreign keys and on columns in frequent WHERE clauses.
- Editing tables by hand in production instead of using migrations.

## Examples

**Two tables with keys, constraints and an index:**

```sql
CREATE TABLE customers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers (id),
  status      text NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

**The same tables as a Prisma schema (Prisma creates `BIGSERIAL` keys instead of identity columns):**

```prisma
model Customer {
  id        BigInt   @id @default(autoincrement())
  email     String   @unique
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  orders    Order[]

  @@map("customers")
}

model Order {
  id         BigInt   @id @default(autoincrement())
  customer   Customer @relation(fields: [customerId], references: [id])
  customerId BigInt   @map("customer_id")
  status     String
  totalCents Int      @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([customerId])
  @@map("orders")
}
```
