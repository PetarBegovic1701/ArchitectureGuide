---
id: pg.view
kind: concept
title: View / materialized view
summary: A saved query that you read like a table. A materialized view stores its result — fast reads for reports, refreshed on a schedule.
level: intermediate
tracks: [data-and-models]
tags: [postgres, reporting, read-model]
related: [pg.table, pg.replica, reads]
references:
  - title: PostgreSQL docs — Views
    url: https://www.postgresql.org/docs/current/tutorial-views.html
  - title: PostgreSQL docs — Materialized views
    url: https://www.postgresql.org/docs/current/rules-materializedviews.html
---

## Beginner

A **view** is a named query: `daily_sales` can join orders and order lines and group them
by day. Code reads it like a table, without repeating the query.

A **materialized view** stores the result, so reading it is fast; it must be refreshed
when the data changes (for example every hour).

## Intermediate

- Views hide columns (a `public_products` view without the purchase price) and give other
  teams a stable read interface over your tables.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` keeps it readable during refresh (needs a
  unique index).
- Views are read-only by default; this tool refuses `writes` to a view.

## Senior

- A materialized view is a simple read model (CQRS-lite): accept staleness in exchange
  for cheap reads.
- Published views are a way to share data across service boundaries without sharing
  tables; version them like an API.

## Common mistakes

- Expecting a materialized view to be up to date without refreshing it.
- Writing to views instead of their tables.

## Examples

**A materialized view for a dashboard:**

```sql
CREATE MATERIALIZED VIEW daily_sales AS
SELECT date_trunc('day', created_at) AS day, sum(total) AS revenue, count(*) AS orders
FROM orders GROUP BY 1;

CREATE UNIQUE INDEX ON daily_sales (day);
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales;
```
