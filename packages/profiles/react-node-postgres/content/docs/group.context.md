---
id: group.context
kind: concept
title: Bounded context
summary: A part of the business with its own model and words. "Order" in Ordering is not the same thing as "order" in Shipping, and that is fine.
level: senior
tracks: [patterns, data-and-models]
tags: [ddd, bounded-context, boundaries]
related: [node.module, pattern.modular-monolith, node.event]
references:
  - title: Martin Fowler — Bounded context
    url: https://martinfowler.com/bliki/BoundedContext.html
---

## Beginner

Large businesses use the same word for different things. In **Ordering**, an order has
items and a price; in **Shipping**, it has parcels and an address. A **bounded context**
draws a line around one of these meanings, so each part can have its own model.

## Intermediate

- Each context has its own modules, tables and language.
- Contexts talk through explicit contracts: APIs or events, translated at the border.
- A context is a good candidate for a module in a modular monolith, or later a service.

## Senior

- Draw context maps (customer/supplier, conformist, anti-corruption layer) to make
  relationships explicit.
- Wrong boundaries cause chatty calls and shared tables; move the line before splitting
  deployables.

## Common mistakes

- One "Order" class used by every part of the system.

## Examples

**Two models of an order:**

```ts
// ordering
type Order = { id: string; lines: { sku: string; qty: number; price: number }[] };
// shipping
type Shipment = { orderId: string; parcels: { weightKg: number }[]; address: string };
```
