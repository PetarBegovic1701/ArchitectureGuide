---
id: notifies
kind: relation
title: notifies
summary: Sends NOTIFY on a LISTEN/NOTIFY channel — a fast signal that is lost if nobody is listening.
level: intermediate
tracks: [concurrency-and-parallelism]
tags: [notify, realtime]
related: [pg.channel, listens, node.ws-gateway]
references:
  - title: PostgreSQL docs — pg_notify
    url: https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-INFO-SESSION
---

## Beginner

`Service notifies stock_changed` means the service sends a short signal on a channel when
stock changes; listeners react right away.

## Intermediate

- Inside a transaction the signal is sent at commit.
- Send IDs only; listeners load fresh data.

## Senior

- Not durable: use it to wake up or invalidate, not to carry work (RNP-010).

## Common mistakes

- Relying on NOTIFY for work that must happen.

## Examples

**Notify with a payload:**

```sql
SELECT pg_notify('stock_changed', $1::text);
```
