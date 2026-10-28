---
id: consumes
kind: relation
title: consumes
summary: Receives messages from a queue, topic or bus and processes them. Set the delivery guarantee — usually at-least-once, so handlers must be idempotent.
level: intermediate
tracks: [concurrency-and-parallelism, patterns]
tags: [messaging, async, idempotency]
related: [publishes, processes, gen.other-broker, node.worker]
references:
  - title: Enterprise Integration Patterns — Idempotent receiver
    url: https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html
---

## Beginner

`A consumes Q` means A takes messages from Q and handles them, at its own pace. If A is
down, messages wait in Q.

## Intermediate

- `deliveryGuarantee`: `at-most-once` (may lose), `at-least-once` (may duplicate),
  `effectively-once` (at-least-once plus deduplication).
- Handlers must tolerate duplicates and out-of-order delivery.
- For a Postgres job queue use `processes`.

## Senior

- Poison messages need a dead-letter queue and alerting.
- Scale consumers by partitions or competing consumers; keep per-key ordering where it
  matters.

## Common mistakes

- Non-idempotent handlers.

## Examples

**Deduplicate by message ID:**

```sql
INSERT INTO processed_messages (id) VALUES ($1) ON CONFLICT DO NOTHING;
```
