---
id: writes
kind: relation
title: writes
summary: Code changes data in a store. Set via, the transaction settings, and concurrencyControl when several writers can change the same rows.
level: beginner
tracks: [data-and-models, concurrency-and-parallelism]
tags: [sql, insert, update, transactions]
related: [reads, topic.concurrency-control, topic.transactions-and-isolation, pg.schema, migrates]
references:
  - title: PostgreSQL docs — Transactions
    url: https://www.postgresql.org/docs/current/tutorial-transactions.html
  - title: PostgreSQL docs — Explicit locking
    url: https://www.postgresql.org/docs/current/explicit-locking.html
quiz:
  - question: Two API instances run "read stock, subtract 1, write stock" at the same time. Without concurrency control, what can happen?
    options:
      [
        Nothing — Postgres serializes everything,
        One sale is lost and the shop can oversell,
        The second request fails with an error,
        The stock goes negative immediately,
      ]
    answer: 1
    explanation: Both read the same value and both write value − 1. That is a lost update. Use a row lock, a version check, an atomic UPDATE, or SERIALIZABLE with retries.
---

## Beginner

`A writes B` means A changes data in B: inserts, updates, deletes. Only the **owner** of a
schema should write it; other services ask the owner.

## Intermediate

- `concurrencyControl` documents how concurrent writers are kept apart: `none`,
  `optimistic-version`, `row-lock`, `advisory-lock`, `serializable-retry`.
- `isolation` documents the transaction isolation level.
- Writes that belong together go in one transaction.

## Senior

- Read-modify-write on contended rows without control loses updates (RNP-019). Try the
  concurrency lab: select a writes arrow and open it there.
- Two services writing the same schema (RNP-001) or a dual write to Postgres and a broker
  (RNP-007) are the most expensive mistakes to undo.
- SERIALIZABLE needs retries on SQLSTATE 40001 (RNP-022).

## Common mistakes

- Read-modify-write without concurrency control.
- Several services writing one schema.
- Calling external services inside the write transaction.

## Examples

**An atomic decrement that cannot oversell:**

```sql
UPDATE products SET stock = stock - $2
WHERE id = $1 AND stock >= $2
RETURNING stock;
```
