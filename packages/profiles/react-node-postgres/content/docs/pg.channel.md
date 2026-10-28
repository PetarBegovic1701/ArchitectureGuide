---
id: pg.channel
kind: concept
title: LISTEN/NOTIFY channel
summary: A Postgres message channel. Fast and simple for "something changed" signals, but not durable — listeners that are not connected miss messages.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [notify, listen, pubsub, realtime]
related: [notifies, listens, node.ws-gateway, pg.job-queue]
references:
  - title: PostgreSQL docs — NOTIFY
    url: https://www.postgresql.org/docs/current/sql-notify.html
  - title: PostgreSQL docs — LISTEN
    url: https://www.postgresql.org/docs/current/sql-listen.html
---

## Beginner

`NOTIFY stock_changed, '42'` sends a short message on a **channel**. Every connection that
ran `LISTEN stock_changed` receives it right away.

It is handy for "something changed, refresh your view" signals, for example to tell a
realtime gateway to push an update.

## Intermediate

- Messages are delivered only to listeners connected **at that moment**; nothing is
  stored. Use a job queue for work that must happen.
- NOTIFY inside a transaction is sent at commit; rolled-back transactions send nothing.
- `LISTEN` needs a dedicated session connection; it does not work through a
  transaction-mode pooler.

## Senior

- Payloads are limited (8000 bytes by default); send IDs, not data.
- Many notifications in one transaction with the same payload are collapsed.
- Good for cache invalidation across instances and for waking up workers early (with the
  queue as the source of truth).

## Common mistakes

- Using NOTIFY for durable work (RNP-010).
- Listening through PgBouncer in transaction mode.

## Examples

**Notify from a trigger, listen in Node:**

```ts
const client = await pool.connect(); // a dedicated connection
await client.query('LISTEN stock_changed');
client.on('notification', (msg) => gateway.push('stock', msg.payload));
```
