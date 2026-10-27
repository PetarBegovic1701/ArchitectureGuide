---
id: pattern.hexagonal
kind: pattern
title: Hexagonal architecture (ports and adapters)
summary: The domain sits in the middle and depends on nothing. It talks to the outside through ports (interfaces) that adapters implement.
level: intermediate
tracks: [patterns, data-and-models]
tags: [ddd, ports-and-adapters, clean-architecture, testing]
related:
  [node.domain, node.port, node.repository, implements, uses-port, node.use-case, pattern.layered]
references:
  - title: Alistair Cockburn — Hexagonal Architecture
    url: https://alistair.cockburn.us/hexagonal-architecture/
  - title: Microsoft — Designing a DDD-oriented microservice
    url: https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice
quiz:
  - question: Which way does the dependency point between the repository adapter and its port?
    options:
      - The port imports the adapter
      - The adapter imports and implements the port
      - The domain imports the adapter
      - They do not depend on each other
    answer: 1
    explanation: Dependencies point inwards. The adapter knows the port (and the database library); the domain and the port know nothing about the adapter.
---

## Beginner

Picture the business rules as the center of the application. Everything technical
(HTTP, the database, e-mail) is outside. The center does not know about the outside:

- A **port** is an interface the center needs, such as `OrderRepository` with
  `findById` and `save`.
- An **adapter** implements the port with real technology, such as a Prisma
  repository. Another adapter can implement the same port in memory for tests.
- An **HTTP adapter** (route handler) calls a use case; so could a CLI or a queue
  consumer.

The center can be tested in milliseconds, without a database.

## Intermediate

- Dependencies point inwards: adapters → application → domain. The domain imports no
  framework or ORM. Check it automatically (dependency-cruiser rule on
  `src/domain/**`).
- Use cases orchestrate: load through a port, call domain methods, save through a port,
  publish events.
- Map at the edges: request DTO → command, entity → row, entity → response. The
  mapping code is the price of independence.
- Transactions: a "unit of work" port, or a repository method that saves an aggregate
  atomically.

## Senior

Hexagonal pays off when the domain is rich: pricing, scheduling, workflows with
invariants. For CRUD it adds interfaces with one implementation and mapping layers that
only copy fields. Keep ports few and shaped by the domain's needs (`OrdersAwaitingPayment`),
not as generic `Repository<T>` wrappers around the ORM. Infrastructure concerns
(retries, idempotency keys, outbox) live in adapters and the application layer, not in
the domain model.

## Analogy

A laptop's USB-C port: the laptop defines the shape; chargers, screens and drives from
any brand plug in. The laptop does not change when you switch charger brands.

## Common mistakes

- Domain classes decorated with ORM annotations, or importing Prisma types.
- Ports that mirror the ORM one-to-one (`findMany(where: any)`).
- Use cases that call adapters directly instead of ports.

## Examples

**Port, adapter and use case:**

```ts
// domain/ports/order-repository.ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | undefined>;
  save(order: Order): Promise<void>;
}

// adapters/db/prisma-order-repository.ts
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}
  async findById(id: OrderId) {
    const row = await this.db.order.findUnique({ where: { id }, include: { lines: true } });
    return row ? Order.fromSnapshot(toSnapshot(row)) : undefined;
  }
  async save(order: Order) {
    await this.db.order.upsert(toUpsert(order.snapshot()));
  }
}

// application/place-order.ts
export const placeOrder = (orders: OrderRepository) => async (cmd: PlaceOrderCommand) => {
  const order = Order.place(cmd.customerId, cmd.lines); // rules live in the domain
  await orders.save(order);
  return order.id;
};
```
