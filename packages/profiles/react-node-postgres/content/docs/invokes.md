---
id: invokes
kind: relation
title: invokes
summary: Runs a database function or procedure — SELECT fn(…), CALL proc(…), or EXECUTE FUNCTION from a trigger.
level: intermediate
tracks: [data-and-models]
tags: [postgres, functions, procedures]
related: [pg.function, pg.trigger, fires-on]
references:
  - title: PostgreSQL docs — CALL
    url: https://www.postgresql.org/docs/current/sql-call.html
---

## Beginner

`Repository invokes reserve_stock` means the code runs a function stored in PostgreSQL
instead of sending its own SQL. The work happens next to the data.

## Intermediate

- Functions are called with `SELECT fn(...)`; procedures with `CALL proc(...)`.
- Triggers invoke functions by themselves when rows change.
- Use `invokes`, not `calls`: this tool refuses `calls` to database code.

## Senior

- Logic in the database is shared by every client but versioned through migrations; keep
  it in the same repository and review it like code.

## Common mistakes

- Hidden SQL logic that the service team does not know about.

## Examples

**Invoke a function from Node:**

```ts
const { rows } = await pool.query('SELECT reserve_stock($1, $2) AS ok', [productId, qty]);
```
