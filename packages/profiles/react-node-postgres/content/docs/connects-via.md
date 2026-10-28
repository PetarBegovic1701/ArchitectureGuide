---
id: connects-via
kind: relation
title: connects via
summary: Database connections go through a connection pooler instead of straight to the database.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [pooling, pgbouncer]
related: [pg.pooler, pg.cluster, node.service]
references:
  - title: PgBouncer — Usage
    url: https://www.pgbouncer.org/usage.html
---

## Beginner

`API connects via PgBouncer` means the API's database connections go to the pooler,
which shares a few real connections to the database between many API instances.

## Intermediate

- Draw `API → pooler` and `pooler → database`.
- Know the pool mode: transaction mode breaks session features.

## Senior

- The pooler becomes critical infrastructure: run it redundantly and monitor wait times.

## Common mistakes

- Large app-side pools behind a pooler.

## Examples

**Point the app at the pooler:**

```bash
DATABASE_URL=postgres://app@pgbouncer:6432/shop
```
