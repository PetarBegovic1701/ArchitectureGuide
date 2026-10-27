---
id: topic.concurrency-control
kind: topic
title: Concurrency control (lost updates, locks, versions)
summary: Ways to stop two requests that change the same data at the same time from overwriting each other.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [postgresql, concurrency, race-condition]
related: [topic.transactions-and-isolation, topic.event-loop-and-parallelism, writes, pg.job-queue]
references:
  - title: PostgreSQL docs — Explicit locking
    url: https://www.postgresql.org/docs/current/explicit-locking.html
  - title: PostgreSQL docs — The locking clause (FOR UPDATE, SKIP LOCKED)
    url: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
quiz:
  - question: Two requests read stock = 1, each subtracts 1 in JavaScript and writes the result. What is the final stock?
    options: ['-1', '0', '1', 'It depends on the isolation level only']
    answer: 1
    explanation: Both write 0. One sale is lost (a "lost update"), and you sold two items with one in stock.
  - question: Which approach makes the second writer fail instead of waiting?
    options:
      [SELECT ... FOR UPDATE, Optimistic version column, Advisory lock, A bigger connection pool]
    answer: 1
    explanation: With a version column the second UPDATE matches no row, so the application sees the conflict and retries or reports it. FOR UPDATE and advisory locks make the second writer wait.
---

## Beginner

Your API serves many users at the same time. Two people buy the last item:

1. Request A reads `stock = 1`.
2. Request B reads `stock = 1`.
3. A writes `stock = 0`. B writes `stock = 0`.

Both purchases succeed, but you had one item. This is a **race condition**, and the
lost change is a **lost update**. It happens more often when you run several
instances of your service, but one Node process can do it too: every `await` lets
other requests run in between.

There are four common fixes:

- **Let the database do the math in one statement:** `SET stock = stock - 1 WHERE stock > 0`.
- **Lock the row** while you work on it (`SELECT ... FOR UPDATE`).
- **Check a version number** when you write, and fail if someone changed the row.
- **Use a stricter isolation level** and retry when the database says "conflict".

## Intermediate

| Strategy             | How                                                                   | When the second writer comes  | Good for                                           |
| -------------------- | --------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------- |
| Atomic update        | One `UPDATE ... SET x = x - $1 WHERE x >= $1`                         | Waits, then re-checks the row | Counters, stock, balances                          |
| Pessimistic lock     | `SELECT ... FOR UPDATE` in a transaction, then update                 | Waits until the first commits | Short, high-conflict work                          |
| Optimistic version   | `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2` | Updates 0 rows → conflict     | Edits by users (forms), low conflict               |
| Serializable + retry | `BEGIN ISOLATION LEVEL SERIALIZABLE`                                  | Fails with 40001 → retry      | Complex rules over many rows                       |
| Advisory lock        | `pg_advisory_xact_lock(key)`                                          | Waits for the same key        | Work that is not one row ("one import per tenant") |

For an HTTP API, map a version conflict to `409 Conflict` (or `412 Precondition
Failed` with `If-Match` / ETags).

**Retries create duplicates** unless the operation is idempotent. Give each "create"
request an **idempotency key** and store it with a unique constraint, so a retried
request returns the first result instead of creating a second order.

## Senior

- `FOR UPDATE` takes a row lock until the end of the transaction; keep the transaction
  short and lock rows in a consistent order to avoid deadlocks (PostgreSQL detects them
  and aborts one transaction with SQLSTATE `40P01`).
- `FOR UPDATE SKIP LOCKED` lets many workers take _different_ rows from a queue table
  without blocking each other. Job queues such as pg-boss are built on it.
- `NOWAIT` fails immediately instead of waiting; useful for "someone else is editing this".
- Optimistic concurrency scales well for low conflict, but under high contention most
  attempts fail; prefer atomic updates or locks there.
- Concurrency in one Node process is real: between `await`s other requests run. Do not
  rely on in-memory locks once you run more than one instance; the database (or a
  dedicated lock service) is the shared source of truth.
- Idempotency keys need a unique index, a stored response (or result reference), and a
  retention period.

## Analogy

A shared document: a **lock** is "only one person may edit at a time"; a **version
check** is "save fails if someone saved since you opened it".

## When to use

- More than one request, worker or instance can change the same rows.
- Clients or queues may retry the same operation.

## When not to use

- Data that only one writer ever changes (for example an append-only event log with unique IDs) needs no extra control.

## Trade-offs

- Locks are simple and correct but make writers wait and can deadlock.
- Optimistic checks never wait but need conflict handling in the UI or a retry.
- SERIALIZABLE protects complex rules but needs retries and costs some throughput.

## Common mistakes

- Read-modify-write in JavaScript without a lock or a version check.
- An in-memory mutex in one Node process, while three instances run in production.
- Retrying a non-idempotent POST and creating duplicate orders.

## Examples

**Atomic update (safe under READ COMMITTED):**

```sql
UPDATE products
   SET stock = stock - $1
 WHERE id = $2
   AND stock >= $1
RETURNING stock;
-- 0 rows returned → not enough stock
```

**Optimistic concurrency with a version column:**

```ts
const result = await pool.query(
  'UPDATE profiles SET bio = $1, version = version + 1 WHERE id = $2 AND version = $3',
  [bio, profileId, expectedVersion],
);
if (result.rowCount === 0) {
  throw new ConflictError('Someone else changed this profile. Reload and try again.');
}
```

**Pessimistic lock inside a transaction:**

```sql
BEGIN;
SELECT balance_cents FROM accounts WHERE id = $1 FOR UPDATE;
-- check the balance in application code, then:
UPDATE accounts SET balance_cents = balance_cents - $2 WHERE id = $1;
COMMIT;
```
