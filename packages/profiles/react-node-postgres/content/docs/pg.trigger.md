---
id: pg.trigger
kind: concept
title: Trigger
summary: Runs a function automatically when rows in a table change — keep updated_at fresh, write an audit log, maintain a counter.
level: intermediate
tracks: [data-and-models]
tags: [postgres, plpgsql, audit]
related: [pg.function, pg.table, fires-on, invokes]
references:
  - title: PostgreSQL docs — CREATE TRIGGER
    url: https://www.postgresql.org/docs/current/sql-createtrigger.html
  - title: PostgreSQL docs — Trigger functions in PL/pgSQL
    url: https://www.postgresql.org/docs/current/plpgsql-trigger.html
---

## Beginner

A **trigger** tells PostgreSQL: "whenever a row in this table is inserted, updated or
deleted, run this function". It runs inside the same transaction, every time, no matter
which app made the change.

Good uses: setting `updated_at`, writing an audit log row, keeping a denormalized counter
correct.

## Intermediate

- `BEFORE` triggers can change the row (`NEW.updated_at = now()`); `AFTER` triggers see
  the final row and can write elsewhere.
- Row-level triggers run per row; statement-level once per statement.
- Triggers are invisible from the application code; document them (this tool draws
  `fires on` and `invokes`).

## Senior

- Business logic in triggers splits rules between SQL and the service (RNP-027). Decide
  deliberately and record the decision.
- Triggers add work to every write and can cause lock contention (hot counters).
- Prefer constraints for validation; triggers for derived data and auditing.

## Common mistakes

- Hidden business rules nobody knows about.
- Triggers that call other triggers in long chains.

## Examples

**Keep updated_at current:**

```sql
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
