---
id: implements
kind: relation
title: implements
summary: An adapter realizes a port — PrismaOrderRepository implements OrderRepository. Only adapters implement ports.
level: senior
tracks: [patterns]
tags: [hexagonal, ports-and-adapters]
related: [node.port, node.repository, uses-port, pattern.hexagonal]
references:
  - title: Alistair Cockburn — Hexagonal architecture
    url: https://alistair.cockburn.us/hexagonal-architecture/
---

## Beginner

`Adapter implements Port` means the adapter keeps the promise the port describes, using a
real technology: a Prisma repository implements `OrderRepository`; a Stripe client
implements `PaymentGateway`.

## Intermediate

- The use case depends on the port (`uses port`); the adapter implements it. Wiring
  happens at startup.
- Several adapters can implement one port: Postgres in production, in-memory in tests.

## Senior

- The arrow points from infrastructure to the application, which is the dependency
  inversion that keeps the core independent.
- This tool refuses the reverse direction ("ports implement adapters").

## Common mistakes

- Ports that leak adapter types.

## Examples

**Two implementations of one port:**

```ts
class InMemoryOrders implements OrderRepository {
  /* tests */
}
class PrismaOrders implements OrderRepository {
  /* production */
}
```
