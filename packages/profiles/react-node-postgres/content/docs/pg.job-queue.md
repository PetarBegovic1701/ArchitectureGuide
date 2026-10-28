---
id: pg.job-queue
kind: concept
title: Postgres job queue
summary: A durable job queue stored in Postgres tables (pg-boss, graphile-worker). Jobs can be added in the same transaction as your data, so neither is lost.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [pg-boss, graphile-worker, skip-locked, jobs]
related: [node.worker, enqueues, processes, pattern.background-jobs, pg.channel]
references:
  - title: PostgreSQL docs — SELECT … FOR UPDATE SKIP LOCKED
    url: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
  - title: pg-boss — README
    url: https://github.com/timgit/pg-boss
quiz:
  - question: Why enqueue the confirmation email job in the same transaction as the order?
    options:
      [
        It is faster,
        So an order never exists without its job and a rolled-back order never sends an email,
        Postgres requires it,
        To avoid using a worker,
      ]
    answer: 1
    explanation: The job and the order commit or roll back together — no lost emails and no emails for orders that do not exist.
---

## Beginner

A **job queue** is a list of work to do later: "send the email for order 42", "build the
invoice PDF". The API adds jobs; workers take them and run them, with retries.

A **Postgres** job queue keeps the jobs in tables of your database. You need no extra
system, and you can add a job in the **same transaction** as the order.

## Intermediate

- Workers take jobs with `SELECT … FOR UPDATE SKIP LOCKED`, so several workers never take
  the same job and never wait for each other.
- Set retries, backoff, expiry and a dead-letter queue.
- Jobs must be idempotent.
- `inTransaction: true` on the `enqueues` relation documents the transactional enqueue.

## Senior

- Throughput is fine for most apps (thousands of jobs per second with tuning); for very
  high volumes or many consumers per message, a broker may fit better.
- Keep job tables small: archive or delete completed jobs, or vacuum will suffer.
- Unlike LISTEN/NOTIFY, jobs survive restarts and offline workers (RNP-010).

## Common mistakes

- Using NOTIFY for work that must not be lost.
- Non-idempotent jobs.
- Enqueuing outside the transaction.

## Examples

**How a worker takes one job safely:**

```sql
UPDATE jobs SET state = 'active', started_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE state = 'created' AND run_after <= now()
  ORDER BY priority DESC, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id, name, data;
```
