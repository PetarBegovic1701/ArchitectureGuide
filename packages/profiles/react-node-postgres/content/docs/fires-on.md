---
id: fires-on
kind: relation
title: fires on
summary: A trigger runs when rows of this table (or view) change.
level: intermediate
tracks: [data-and-models]
tags: [postgres, triggers]
related: [pg.trigger, pg.table, invokes]
references:
  - title: PostgreSQL docs — Triggers
    url: https://www.postgresql.org/docs/current/triggers.html
---

## Beginner

`Trigger fires on orders` means the trigger watches the `orders` table and runs whenever
rows there are inserted, updated or deleted (as configured).

## Intermediate

- Set `timing` (before/after/instead-of) and `events` on the trigger.
- `INSTEAD OF` triggers on views make them writable.

## Senior

- Every write to the table pays for the trigger; measure on hot tables.

## Common mistakes

- Forgetting that bulk updates fire row triggers once per row.

## Examples

**Fire an audit trigger after updates:**

```sql
CREATE TRIGGER price_audit AFTER UPDATE OF price ON products
FOR EACH ROW EXECUTE FUNCTION write_price_audit();
```
