---
id: topic.transactions-and-isolation
kind: topic
title: Transactions and isolation levels
summary: A transaction groups SQL statements so they succeed or fail together; the isolation level decides what concurrent transactions can see.
level: intermediate
tracks: [concurrency-and-parallelism, data-and-models]
tags: [postgresql, concurrency]
related: [topic.concurrency-control, writes, reads, pg.database]
references:
  - title: PostgreSQL docs — Transaction isolation
    url: https://www.postgresql.org/docs/current/transaction-iso.html
  - title: PostgreSQL docs — Transactions tutorial
    url: https://www.postgresql.org/docs/current/tutorial-transactions.html
quiz:
  - question: What is the default isolation level in PostgreSQL?
    options: [Read uncommitted, Read committed, Repeatable read, Serializable]
    answer: 1
    explanation: PostgreSQL uses READ COMMITTED unless you ask for another level. Each statement sees data committed before that statement started.
  - question: A SERIALIZABLE transaction fails with SQLSTATE 40001. What should the application do?
    options:
      [Show an error to the user, Retry the whole transaction, Switch to READ COMMITTED, Ignore it]
    answer: 1
    explanation: 40001 is a serialization failure. The transaction did nothing; run the whole transaction again (usually a few times with a short delay).
---

## Beginner

A **transaction** is a group of database changes that belong together. Either all
of them are saved (`COMMIT`) or none of them are (`ROLLBACK`).

Example: when a customer places an order, you insert the order **and** lower the
stock. If the server crashes between the two, you do not want an order without
a stock change. Put both statements in one transaction.

Many people use the database at the same time. The **isolation level** decides how
much one transaction "sees" of the others while they run. Stricter levels are safer
but can make transactions fail, and then the application has to try again.

## Intermediate

PostgreSQL has three useful levels (READ UNCOMMITTED behaves like READ COMMITTED):

- **READ COMMITTED** (default): every _statement_ sees the data committed before it
  started. Two statements in the same transaction can see different data.
- **REPEATABLE READ**: the whole transaction sees one snapshot, taken at its first
  statement. If another transaction changed a row you then try to update, PostgreSQL
  stops your transaction with a serialization error.
- **SERIALIZABLE**: the result is the same as if the transactions ran one after
  the other. PostgreSQL detects dangerous patterns and aborts one transaction with
  SQLSTATE `40001`. Your code must retry.

Keep transactions short. A transaction that waits for an HTTP call holds its locks
and its database connection the whole time.

## Senior

PostgreSQL implements REPEATABLE READ as snapshot isolation and SERIALIZABLE as
Serializable Snapshot Isolation (SSI). SSI adds predicate locks (`SIReadLock`) and
aborts transactions that would form a dangerous structure of read-write
dependencies, so write skew (two doctors both going off call) is prevented, which
plain snapshot isolation allows.

Practical rules:

- Under READ COMMITTED, single-statement atomic updates such as
  `UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0` are safe:
  the row is re-checked after a concurrent update commits. Read-modify-write in
  application code is not (see _Concurrency control_).
- SERIALIZABLE needs a retry loop around the **whole** transaction, idempotent side
  effects, and declaring read-only transactions (`READ ONLY`, and `DEFERRABLE` for
  long reports) to reduce false positives.
- With a pooler in transaction mode (PgBouncer), session state (`SET`, advisory
  session locks, prepared statements in older setups) does not survive between
  transactions. Set the isolation level per transaction: `BEGIN ISOLATION LEVEL ...`.

## When to use

- Several statements must succeed or fail together.
- A business rule depends on data read earlier in the same transaction (use REPEATABLE READ or SERIALIZABLE, or explicit locks).

## When not to use

- Do not keep a transaction open while you call another service or wait for a user.

## Common mistakes

- Reading a value, computing in JavaScript, and writing it back without a lock or a version check (lost update).
- Using SERIALIZABLE without retrying on SQLSTATE 40001.
- Opening a transaction on one pool connection and running a statement on another (each `pool.query` may use a different connection).

## Examples

**A transaction with node-postgres (one connection for the whole transaction):**

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    'INSERT INTO orders (customer_id, total_cents) VALUES ($1, $2) RETURNING id',
    [customerId, totalCents],
  );
  const stock = await client.query(
    'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
    [quantity, productId],
  );
  if (stock.rowCount === 0) throw new OutOfStockError(productId); // → ROLLBACK, no order
  await client.query('COMMIT');
  return rows[0].id;
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**Retry a SERIALIZABLE transaction:**

```ts
async function withSerializable<T>(work: (c: PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const retryable = (error as { code?: string }).code === '40001';
      if (!retryable || attempt >= attempts) throw error;
    } finally {
      client.release();
    }
  }
}
```
