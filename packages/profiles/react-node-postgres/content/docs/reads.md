---
id: reads
kind: relation
title: reads
summary: Code reads data from a store. Set via (the data-access library) and, where it matters, the isolation level.
level: beginner
tracks: [data-and-models]
tags: [sql, select, queries]
related: [writes, node.repository, pg.schema, topic.transactions-and-isolation]
references:
  - title: PostgreSQL docs — Queries
    url: https://www.postgresql.org/docs/current/queries.html
---

## Beginner

`A reads B` means A loads data from the store B: the API reads the `orders` schema. Draw
reads and writes as separate arrows; it makes clear who changes what and who only looks.

## Intermediate

- `via` names the library (prisma, drizzle, kysely, pg).
- Reading another service's tables couples you to its schema; prefer its API or a
  published view.
- Reads can go to a replica when slightly old data is fine.

## Senior

- Read-then-write in a transaction needs a concurrency strategy, or another request can
  change the row in between (lost update).
- Isolation level on the arrow (`read-committed`, `repeatable-read`, `serializable`)
  documents what the code relies on.

## Common mistakes

- N+1 queries.
- Reading another service's tables directly.

## Examples

**Load an order with its lines in one query (Prisma):**

```ts
const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
```
