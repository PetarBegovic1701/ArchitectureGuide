---
id: pg.function
kind: concept
title: Stored functions and procedures
summary: Code that runs inside PostgreSQL, next to the data; useful for atomic multi-step changes, but it splits logic between two places.
level: intermediate
tracks: [data-and-models]
tags: [postgresql, plpgsql, stored-procedure]
related:
  [pg.trigger, pg.table, invokes, topic.transactions-and-isolation, topic.concurrency-control]
references:
  - title: PostgreSQL docs — CREATE FUNCTION
    url: https://www.postgresql.org/docs/current/sql-createfunction.html
  - title: PostgreSQL docs — CREATE PROCEDURE
    url: https://www.postgresql.org/docs/current/sql-createprocedure.html
  - title: PostgreSQL docs — PL/pgSQL
    url: https://www.postgresql.org/docs/current/plpgsql.html
quiz:
  - question: What can a procedure do that a function cannot?
    options: [Return a value, Run COMMIT or ROLLBACK inside its body, Read tables, Take parameters]
    answer: 1
    explanation: Procedures (CALL) may control transactions when they are not called inside an outer transaction block. Functions always run inside the caller's transaction.
---

## Beginner

Usually your Node service sends SQL to PostgreSQL. A **stored function** (or
**procedure**) is a piece of code you save _inside_ the database, and then call by
name:

```sql
SELECT reserve_stock(42, 1);
```

It runs right next to the data, so several steps happen in one round trip, and every
application that uses the database gets the same rule. The downside: some of your
business logic now lives in SQL, outside your TypeScript code, tests and code review
habits.

In the diagram, Node code **invokes** a function. A **trigger** is a function the
database runs by itself when rows change.

## Intermediate

- **Function** (`CREATE FUNCTION`, called with `SELECT`): returns a value or rows, runs
  inside the caller's transaction, cannot `COMMIT`.
- **Procedure** (`CREATE PROCEDURE`, called with `CALL`, PostgreSQL 11+): no return value
  (only `OUT` parameters), may `COMMIT`/`ROLLBACK` in its body when called outside a
  transaction block. Good for batch jobs.
- **Languages:** `LANGUAGE sql` for one query, `plpgsql` for variables, `IF`, loops and
  error handling.
- **Volatility:** mark functions `IMMUTABLE` or `STABLE` when true; the planner uses it.
  Default is `VOLATILE`.
- Create and change functions through **migrations** like tables
  (`CREATE OR REPLACE FUNCTION`).

## Senior

- `SECURITY DEFINER` runs with the owner's rights: always `SET search_path` on the
  function (for example `SET search_path = pg_catalog, public`) or a user can shadow
  objects; grant `EXECUTE` narrowly.
- Good fits: invariants that must hold for every writer, set-based operations that
  would otherwise be N round trips, RLS helper functions, audit triggers.
- Weak fits: orchestration with external calls (functions cannot call HTTP safely),
  logic that changes often, or teams without SQL review and testing (pgTAP).
- Versioning: changing a signature creates an overload; drop the old one explicitly.
  Deploy order matters when application code calls the new function.
- Observability: use `pg_stat_user_functions` (`track_functions`) and `auto_explain` for
  nested statements.

## When to use

- Several statements must run atomically with minimal latency, close to the data.
- A rule must hold no matter which application or script writes the table.

## When not to use

- The logic calls other services, or changes every sprint.
- Your team cannot test and review SQL code like application code.

## Trade-offs

- Fewer round trips and stronger guarantees, against logic split across two languages and harder debugging.

## Common mistakes

- `SECURITY DEFINER` without a fixed `search_path`.
- Creating functions by hand instead of in migrations.
- Hiding big side effects in triggers that nobody on the team knows about.

## Examples

**A function that reserves stock atomically:**

```sql
CREATE FUNCTION reserve_stock(p_product_id bigint, p_quantity integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE products
     SET stock = stock - p_quantity
   WHERE id = p_product_id
     AND stock >= p_quantity;
  RETURN FOUND; -- true when a row was updated
END;
$$;
```

**Invoking it from Node.js:**

```ts
// node-postgres
const { rows } = await pool.query('SELECT reserve_stock($1, $2) AS ok', [productId, quantity]);

// Prisma: the tagged template sends parameters, not string concatenation
const [result] = await prisma.$queryRaw<{ ok: boolean }[]>`
  SELECT reserve_stock(${productId}::bigint, ${quantity}::int) AS ok`;
```
