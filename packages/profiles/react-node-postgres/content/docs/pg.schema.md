---
id: pg.schema
kind: concept
title: Schema (ownership boundary)
summary: A namespace of tables inside a database. In this tool it is also the ownership boundary — one service owns a schema and runs its migrations.
level: beginner
tracks: [data-and-models, auth]
tags: [postgres, migrations, ownership, rls]
related: [pg.table, pg.database, migrates, node.service, topic.models]
references:
  - title: PostgreSQL docs — Schemas
    url: https://www.postgresql.org/docs/current/ddl-schemas.html
  - title: PostgreSQL docs — Row security policies
    url: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
---

## Beginner

A **schema** is a folder for tables inside a database: `orders.orders`,
`orders.order_items`, `catalog.products`. The default schema is called `public`.

In this tool a schema also marks **ownership**: one service owns it. Only that service
changes its tables (**migrates**) and writes to them; others ask that service.

## Intermediate

- **Migrations** are versioned scripts (Prisma Migrate, Drizzle Kit, node-pg-migrate) that
  create and change tables. Exactly one owner runs them.
- Other services that need the data call the owner's API, or read a published view or
  replica.
- Database roles per service (`GRANT USAGE ON SCHEMA orders TO orders_app`) enforce the
  boundary.
- **Row Level Security** (`rls`) restricts rows per user or tenant inside the database.

## Senior

- Shared tables are the hardest coupling to undo; this tool flags them (RNP-001) and
  migrations by several owners (RNP-002).
- Expand-and-contract migrations (add, backfill, switch, remove) keep deploys zero
  downtime.
- With RLS, set the tenant or user per transaction (`SET LOCAL app.user_id`) and test the
  policies like code.

## Common mistakes

- Several services running migrations on the same schema.
- Everything in `public` with no ownership.
- RLS enabled without tests, so a policy silently allows everything.

## Examples

**One schema per owner, with a role:**

```sql
CREATE SCHEMA orders AUTHORIZATION orders_app;
REVOKE ALL ON SCHEMA orders FROM PUBLIC;
GRANT USAGE ON SCHEMA orders TO reporting_reader;
```
