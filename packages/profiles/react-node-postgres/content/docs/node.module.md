---
id: node.module
kind: concept
title: Module (backend)
summary: A part of a service with its own responsibility, its own tables and a small public API — "orders", "payments". Modules talk only through their public APIs.
level: intermediate
tracks: [patterns]
tags: [modular-monolith, nestjs, boundaries]
related: [pattern.modular-monolith, node.event, emits, handles, depends-on]
references:
  - title: NestJS — Modules
    url: https://docs.nestjs.com/modules
  - title: Kamil Grzybek — Modular monolith primer
    url: https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer
---

## Beginner

A big service is easier to change when it is split into **modules**, each responsible for
one area: orders, payments, catalog. A module has a **public API** (functions other
modules may call) and keeps everything else private.

## Intermediate

- Each module owns **its tables** (its schema); other modules do not read them directly.
- Modules talk through public calls or **events** (`OrderPlaced`) instead of reaching
  into each other's code.
- This is the core of a **modular monolith**: one deployable, clear inner boundaries,
  easy to split later.

## Senior

- Enforce boundaries in CI (dependency-cruiser, ESLint boundaries, Nx tags); this tool's
  rules check them in the model (cross-module writes, shared tables).
- Synchronous calls between modules couple their availability and transactions; events
  decouple them but add eventual consistency.
- Cyclic dependencies between modules are the first sign a boundary is wrong.

## Common mistakes

- Module A writing module B's tables.
- A "common" module that every module depends on and that holds business logic.

## Examples

**A module's public API:**

```ts
// modules/orders/index.ts — other modules import only this
export { placeOrder, getOrder } from './application';
export type { OrderSummary } from './contracts';
```
