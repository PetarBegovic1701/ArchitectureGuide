---
id: node.port
kind: concept
title: Port (interface)
summary: An interface the application needs — OrderRepository, PaymentGateway — written in its own terms. Adapters implement it with a real database or service.
level: senior
tracks: [patterns]
tags: [hexagonal, ports-and-adapters, dependency-inversion]
related: [pattern.hexagonal, node.repository, node.use-case, implements, uses-port]
references:
  - title: Alistair Cockburn — Hexagonal architecture
    url: https://alistair.cockburn.us/hexagonal-architecture/
  - title: Martin Fowler — Dependency injection
    url: https://martinfowler.com/articles/injection.html
---

## Beginner

A **port** is a promise: "I need something that can save and load orders". The
application code depends only on that promise (an interface). A separate **adapter**
keeps it, for example with Prisma and PostgreSQL.

In tests you can plug in a simple in-memory adapter.

## Intermediate

- Ports are named in business terms (`OrderRepository.findById`), not technical ones
  (`PrismaClient`).
- Use cases **use ports**; adapters **implement** them (`implements` relation).
- Wire adapters to ports at startup (manual wiring or a DI container like NestJS).

## Senior

- The direction is the point: infrastructure depends on the application, not the other
  way round. Check it with dependency rules.
- Do not create ports "just in case" for everything; add them where you need to swap or
  isolate (databases, payment providers, clocks).
- Leaky ports (returning ORM entities) undo the benefit.

## Common mistakes

- Ports that mirror the ORM API.
- Use cases importing the adapter directly.

## Examples

**A port and its adapter:**

```ts
// application/ports/OrderRepository.ts
export interface OrderRepository {
  findById(id: string): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
}

// infrastructure/PrismaOrderRepository.ts
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}
  async findById(id: string) {
    const row = await this.db.order.findUnique({ where: { id } });
    return row ? Order.fromRow(row) : undefined;
  }
  async save(order: Order) {
    await this.db.order.upsert({
      where: { id: order.id },
      create: order.toRow(),
      update: order.toRow(),
    });
  }
}
```
