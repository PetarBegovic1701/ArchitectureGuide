---
id: publishes
kind: relation
title: publishes
summary: Sends messages or events to a queue, topic or bus and does not wait for anyone to process them.
level: intermediate
tracks: [concurrency-and-parallelism, patterns]
tags: [messaging, async, events]
related: [consumes, gen.other-broker, node.event, enqueues]
references:
  - title: Enterprise Integration Patterns — Publish-subscribe channel
    url: https://www.enterpriseintegrationpatterns.com/patterns/messaging/PublishSubscribeChannel.html
---

## Beginner

`A publishes to Q` means A drops a message into Q and carries on. Whoever consumes Q will
handle it later. A does not wait, and does not know who the consumers are.

## Intermediate

- For a Postgres job queue use the more specific `enqueues`; for LISTEN/NOTIFY use
  `notifies`.
- Messages need a stable, versioned shape.

## Senior

- Publishing and saving data must be atomic: use a transactional outbox, or a broker that
  shares your database transaction (a Postgres queue). Otherwise RNP-004 (dual write)
  applies.

## Common mistakes

- Publishing before the transaction commits, or after it without an outbox.

## Examples

**Outbox row instead of publishing directly:**

```sql
INSERT INTO outbox (topic, payload) VALUES ('order.placed', '{"orderId": "42"}');
```
