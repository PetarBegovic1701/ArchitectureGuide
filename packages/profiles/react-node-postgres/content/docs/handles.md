---
id: handles
kind: relation
title: handles
summary: Reacts to an event — the warehouse module handles OrderPlaced by reserving stock. Handlers must be idempotent.
level: intermediate
tracks: [patterns]
tags: [events, handlers]
related: [emits, node.event, node.module, consumes]
references:
  - title: microservices.io — Idempotent consumer
    url: https://microservices.io/patterns/communication-style/idempotent-consumer.html
---

## Beginner

`Warehouse handles OrderPlaced` means whenever an order is placed, the warehouse code runs
its reaction (reserve stock, plan picking).

## Intermediate

- A handler may run twice (redelivery): check whether the work is already done.
- One event, many handlers: each handler should be independent of the others.

## Senior

- Handler failures must not block other handlers; isolate them with separate queues or
  retries per handler.

## Common mistakes

- Handlers that assume they run exactly once.

## Examples

**An idempotent handler:**

```ts
on('OrderPlaced', async ({ orderId }) => {
  if (await reservations.exists(orderId)) return;
  await reservations.create(orderId);
});
```
