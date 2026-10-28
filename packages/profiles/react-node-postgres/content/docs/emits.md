---
id: emits
kind: relation
title: emits
summary: Raises a domain or integration event — "this happened". The emitter does not know who listens.
level: intermediate
tracks: [patterns]
tags: [events, ddd]
related: [handles, node.event, node.domain, publishes]
references:
  - title: Martin Fowler — Domain event
    url: https://martinfowler.com/eaaDev/DomainEvent.html
---

## Beginner

`Orders emits OrderPlaced` means the orders code announces that an order was placed.
Others can react without the orders code knowing about them.

## Intermediate

- Emit after the state change is saved, or in the same transaction through an outbox.
- Events carry facts (IDs, amounts), not instructions.

## Senior

- Domain events inside a process can be dispatched in memory after commit; integration
  events across services need durable delivery.

## Common mistakes

- Emitting events for changes that are later rolled back.

## Examples

**Collect events in the aggregate, dispatch after commit:**

```ts
order.place(); // records OrderPlaced inside the aggregate
await repo.save(order); // same transaction writes the outbox
await outbox.flush(); // after commit
```
