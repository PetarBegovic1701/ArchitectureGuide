---
id: group.layer
kind: concept
title: Layer
summary: A horizontal band of a design — presentation, application, domain, infrastructure. Each layer may only depend on the layers below it.
level: intermediate
tracks: [patterns]
tags: [layered-architecture, groups]
related: [pattern.layered, pattern.hexagonal, node.use-case]
references:
  - title: Martin Fowler — Presentation domain data layering
    url: https://martinfowler.com/bliki/PresentationDomainDataLayering.html
---

## Beginner

A **layer** groups code by its role: the **presentation** layer talks to users (HTTP
handlers, pages), the **application** layer runs use cases, the **domain** layer holds
rules, the **infrastructure** layer talks to databases and providers.

The rule: a layer may use the layers below it, never the ones above.

## Intermediate

- Draw a layer group and put shapes inside; arrows connect the shapes, not the group.
- In a hexagonal design the domain is in the middle and infrastructure depends on it
  (dependency inversion).

## Senior

- Layers are a dependency rule, so enforce them in CI (dependency-cruiser), not only in
  folders.
- Strict layering everywhere can add ceremony for simple CRUD; apply it where the rules
  are complex.

## Common mistakes

- Domain code importing infrastructure (RNP-006).

## Examples

**Folders by layer:**

```bash
src/presentation/http/orders.ts
src/application/placeOrder.ts
src/domain/order.ts
src/infrastructure/prismaOrderRepository.ts
```
