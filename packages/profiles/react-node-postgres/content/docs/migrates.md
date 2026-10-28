---
id: migrates
kind: relation
title: migrates
summary: This element owns the schema's DDL — it runs the migrations that create and change tables. Exactly one owner per schema.
level: beginner
tracks: [data-and-models]
tags: [migrations, ownership, ddl]
related: [pg.schema, node.service, writes]
references:
  - title: Prisma — Migrate
    url: https://www.prisma.io/docs/orm/prisma-migrate
  - title: Martin Fowler — Evolutionary database design
    url: https://martinfowler.com/articles/evodb.html
---

## Beginner

Tables change over time: a new column, a new index. Those changes are **migrations**,
small versioned scripts. `API migrates orders` means the API owns the `orders` schema and
is the only one that runs its migrations.

## Intermediate

- Run migrations in the deploy pipeline before the new code starts.
- Make them backward compatible (expand and contract) so old and new code can run at the
  same time.

## Senior

- Two migration owners for one schema (RNP-002) leads to conflicting histories and broken
  deploys.
- Large table changes need online techniques (`CREATE INDEX CONCURRENTLY`, batched
  backfills).

## Common mistakes

- Several services migrating one schema.
- Renaming a column in one step while old code still reads it.

## Examples

**An expand step that old code tolerates:**

```sql
ALTER TABLE orders ADD COLUMN currency text NOT NULL DEFAULT 'EUR';
```
