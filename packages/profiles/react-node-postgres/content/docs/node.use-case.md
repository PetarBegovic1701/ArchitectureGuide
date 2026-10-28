---
id: node.use-case
kind: concept
title: Use case / application service
summary: One business action — PlaceOrder, RefundOrder — as one function or class. It loads data, asks the domain to apply the rules, saves, and starts follow-up work.
level: intermediate
tracks: [patterns, data-and-models]
tags: [application-service, clean-architecture, transactions]
related:
  [
    node.domain,
    node.port,
    node.repository,
    pattern.layered,
    pattern.hexagonal,
    topic.transactions-and-isolation,
  ]
references:
  - title: Martin Fowler — Service layer
    url: https://martinfowler.com/eaaCatalog/serviceLayer.html
  - title: Alistair Cockburn — Hexagonal architecture
    url: https://alistair.cockburn.us/hexagonal-architecture/
---

## Beginner

A **use case** is one thing the system does for someone: place an order, cancel a
booking, refund a payment. It is written once and called from wherever the action starts:
an HTTP handler, a background job, an admin script.

It coordinates the steps: load what is needed, check the rules, save the changes, and
start follow-up work (send the email).

## Intermediate

- One use case = one **transaction** boundary in most designs: either everything is saved
  or nothing.
- It depends on **ports** (interfaces like `OrderRepository`) or on repositories directly
  in a layered design, never on HTTP objects.
- Return a result or a domain error; let the handler choose the status code.
- Enqueue follow-up jobs in the same transaction.

## Senior

- Use cases are the natural unit for authorization ("may this user refund this order?"),
  idempotency (an idempotency key per command) and auditing.
- Keep them small; a use case calling other use cases often hides a missing domain
  concept or event.
- Under concurrency, the use case decides the strategy for contended writes (version
  check, row lock) — see the concurrency lab.

## Common mistakes

- Business rules split between handlers and repositories, with nothing in between.
- Use cases that take `req` and `res`.
- Sending emails before the transaction commits.

## Examples

**PlaceOrder with a transaction and a job:**

```ts
export async function placeOrder(userId: string, input: PlaceOrderInput) {
  return db.transaction(async (tx) => {
    const product = await products.lockById(tx, input.productId); // SELECT … FOR UPDATE
    if (product.stock < input.quantity) throw new OutOfStock(product.id);
    await products.updateStock(tx, product.id, product.stock - input.quantity);
    const order = await orders.insert(tx, { userId, ...input });
    await jobs.send(tx, 'send-confirmation', { orderId: order.id });
    return order;
  });
}
```
