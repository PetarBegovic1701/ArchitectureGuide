---
id: uses-port
kind: relation
title: uses port
summary: Code depends on an interface instead of a concrete implementation, so the implementation can be swapped or faked in tests.
level: senior
tracks: [patterns]
tags: [hexagonal, dependency-inversion]
related: [node.port, implements, node.use-case]
references:
  - title: Martin Fowler — Inversion of control containers and the DI pattern
    url: https://martinfowler.com/articles/injection.html
---

## Beginner

`Use case uses port` means the use case asks for "something that can save orders" and
does not care which database does it. That makes it easy to test with a fake.

## Intermediate

- Pass the port in (constructor or function argument); do not import the adapter.
- One port per real need; avoid one giant "Database" port.

## Senior

- Ports are the seams for testing and for replacing infrastructure; place them at
  volatile boundaries (databases, providers, time), not everywhere.

## Common mistakes

- Use cases importing a concrete repository while also declaring a port.

## Examples

**Inject the port:**

```ts
export const makePlaceOrder = (orders: OrderRepository) => async (input: PlaceOrderInput) => {
  /* uses orders.save(...) */
};
```
