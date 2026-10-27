---
id: pattern.layered
kind: pattern
title: Layered architecture
summary: Code is split into presentation, application and data-access layers. Each layer calls only the layer below it.
level: beginner
tracks: [patterns, api-design]
tags: [layers, service-layer, repository]
related:
  [node.route-handler, node.use-case, node.repository, pg.table, topic.models, pattern.hexagonal]
references:
  - title: Martin Fowler — Presentation Domain Data Layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
  - title: Martin Fowler — Service Layer (P of EAA)
    url: https://martinfowler.com/eaaCatalog/serviceLayer.html
  - title: Martin Fowler — Repository (P of EAA)
    url: https://martinfowler.com/eaaCatalog/repository.html
quiz:
  - question: Where does the rule "an order cannot be cancelled after it has shipped" belong?
    options:
      - In the route handler
      - In the use case (application layer)
      - In the repository
      - In a database trigger only
    answer: 1
    explanation: Route handlers translate HTTP, repositories store data. Business rules belong in the use case, so every entry point (HTTP, jobs, scripts) applies them.
---

## Beginner

Every request goes **down** through three layers:

1. **Route handler** (presentation): reads the HTTP request, validates it, calls a
   use case, turns the result into a response.
2. **Use case / service** (application): the business rules. "Place order", "Cancel
   order".
3. **Repository** (data access): runs the queries. Only this layer knows SQL or the ORM.

A layer never skips the one below it, and never calls the one above it. When something
breaks, you know where to look.

## Intermediate

- Handlers stay thin: no queries, no rules. If a handler is longer than the use case it
  calls, rules are leaking upwards.
- One repository per entity (or per aggregate). Use cases can call several
  repositories inside one transaction; pass the transaction down.
- Errors travel up as typed results or domain errors (`OrderNotFound`), and only the
  handler maps them to HTTP status codes.
- Test use cases with fake repositories; test repositories against a real PostgreSQL
  (Testcontainers or a test database).

## Senior

Plain layering lets the application layer depend on data-access types, for example
Prisma models returned from repositories. That couples rules to the schema. Map rows to
your own types at the repository boundary, or move to ports and adapters
(hexagonal) when the domain is complex. Organize folders by feature first and by layer
second (`orders/http`, `orders/application`, `orders/db`) so a feature's code stays
together as the service grows.

## Analogy

A post office: the counter (handler) takes your parcel, the sorting room (use case)
decides where it goes, and the warehouse (repository) stores it. Customers never walk
into the warehouse.

## Common mistakes

- Calling the ORM from route handlers "just this once".
- Use cases that receive `req` and `res`: they then only work over HTTP.
- Repositories with business rules (`if (order.status === 'shipped') ...`).

## Examples

**Handler → use case → repository:**

```ts
// http/orders.routes.ts
router.post('/orders/:id/cancel', async (req, res) => {
  const result = await cancelOrder(req.params.id, req.user.id);
  if (result === 'not-found') return res.status(404).end();
  if (result === 'already-shipped') return res.status(409).json({ error: 'Already shipped' });
  res.status(204).end();
});

// application/cancel-order.ts
export async function cancelOrder(orderId: string, userId: string) {
  const order = await orders.findById(orderId);
  if (!order || order.customerId !== userId) return 'not-found';
  if (order.status === 'shipped') return 'already-shipped';
  await orders.updateStatus(orderId, 'cancelled');
  return 'ok';
}
```
