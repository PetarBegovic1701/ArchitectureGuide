---
id: pattern.cqrs
kind: pattern
title: CQRS-lite on PostgreSQL
summary: Commands change the write tables; a projector keeps read models (projection tables and materialized views) up to date; queries read only the read models.
level: senior
tracks: [patterns, data-and-models]
tags: [cqrs, read-model, projection, materialized-view, eventual-consistency]
related: [pg.view, pg.table, pg.job-queue, node.worker, node.use-case, topic.models, pattern.outbox]
references:
  - title: Martin Fowler — CQRS
    url: https://martinfowler.com/bliki/CQRS.html
  - title: Microsoft — CQRS pattern
    url: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs
  - title: PostgreSQL docs — Materialized views
    url: https://www.postgresql.org/docs/current/rules-materializedviews.html
quiz:
  - question: Who should write a read model?
    options:
      - Any route handler that needs it
      - Only the projector that derives it from the write tables
      - The browser
      - Nobody; read models are views only
    answer: 1
    explanation: Read models are derived data. If request code writes them directly they drift from the write tables, and they can no longer be rebuilt from scratch.
---

## Beginner

Some screens need data in a very different shape from how it is saved: a dashboard with
totals per day, a list that joins five tables. Computing that on every request is slow.

CQRS ("command query responsibility segregation") splits the two sides:

- **Commands** (place order, cancel order) change the normal tables: the **write model**.
- A **projector** builds **read models** from those tables: tables or materialized views
  shaped exactly for a screen.
- **Queries** read only the read models.

The read models are a little behind the writes, usually by milliseconds to seconds.

## Intermediate

- Trigger the projector with a job enqueued in the command's transaction (or from an
  outbox), so no change is missed.
- A materialized view is the simplest read model: `REFRESH MATERIALIZED VIEW
CONCURRENTLY` rebuilds it without blocking readers (it needs a unique index).
- Projection tables updated row by row scale better than refreshing a whole view.
- Make projections idempotent and rebuildable: you will need to rebuild them when their
  shape changes.
- Screens must handle the lag: after a command, show the command's result, not a fresh
  query of the read model.

## Senior

"CQRS-lite" keeps one database and one service; it does not require event sourcing. Add
it per screen where reads hurt, not for the whole system. Watch projector lag as a
metric. For heavy analytics, a replica or a separate analytical store may be the better
read side. Keep read models in the service's own schema so ownership stays clear.

## Analogy

A shop's sales ledger is the write model; the weekly sales poster in the back office is
a read model. Someone updates the poster from the ledger; nobody writes sales directly
onto the poster.

## Common mistakes

- Route handlers writing read models directly.
- Read models that cannot be rebuilt from the write tables.
- Applying CQRS to simple CRUD screens.
- Screens that query the read model right after a command and show stale data.

## Examples

**A read model as a materialized view, refreshed without blocking readers:**

```sql
CREATE MATERIALIZED VIEW sales_by_day AS
  SELECT date_trunc('day', created_at) AS day, sum(total_cents) AS total_cents
  FROM orders GROUP BY 1;
CREATE UNIQUE INDEX ON sales_by_day (day);
REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_day;
```
