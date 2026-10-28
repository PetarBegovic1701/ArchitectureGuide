---
id: enqueues
kind: relation
title: enqueues
summary: Adds a job to a Postgres job queue. Set inTransaction when the job is added in the same transaction as the data.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [jobs, queues, transactions]
related: [pg.job-queue, processes, node.worker, publishes]
references:
  - title: pg-boss — send()
    url: https://timgit.github.io/pg-boss/#/./api/jobs?id=send
---

## Beginner

`Use case enqueues send-email` means the use case adds a job to the queue and moves on; a
worker will send the email.

## Intermediate

- `inTransaction: true` means the job is added in the same transaction as the business
  data — both commit or neither does.
- Pass IDs, not whole objects; the worker loads fresh data.

## Senior

- Use a singleton key or deduplication when the same job must not be queued twice.

## Common mistakes

- Enqueuing outside the transaction (lost or orphaned jobs).

## Examples

**Enqueue in the transaction with a singleton key:**

```ts
await boss.send('send-confirmation', { orderId }, { db: tx, singletonKey: orderId });
```
