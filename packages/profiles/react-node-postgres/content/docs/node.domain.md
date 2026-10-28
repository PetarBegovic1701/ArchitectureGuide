---
id: node.domain
kind: concept
title: Domain model / aggregate
summary: The business rules and state, written as plain code without database or HTTP — an Order that refuses to ship before it is paid.
level: intermediate
tracks: [data-and-models, patterns]
tags: [ddd, aggregate, entity, value-object]
related: [topic.models, node.use-case, node.port, node.event, emits]
references:
  - title: Martin Fowler — DDD aggregate
    url: https://martinfowler.com/bliki/DDD_Aggregate.html
  - title: Martin Fowler — Anemic domain model
    url: https://martinfowler.com/bliki/AnemicDomainModel.html
---

## Beginner

The **domain model** is where the business rules live: "an order can only be shipped
when it is paid", "a discount cannot exceed 50%". It is plain TypeScript: no SQL, no
Express, no fetch.

Because it has no I/O, it is easy to read and to test, and the rules are in one place.

## Intermediate

- An **aggregate** is a cluster of objects changed together and saved together (an Order
  with its lines). Other code changes it only through its methods.
- **Value objects** (Money, Email) validate themselves and are compared by value.
- The domain may **emit events** (`OrderPlaced`) that other parts react to.
- It does not read or write the database; a repository loads and saves it (this tool
  refuses `reads`/`writes` from domain shapes).

## Senior

- Aggregate boundaries are consistency boundaries: one transaction changes one
  aggregate; across aggregates, use events and accept eventual consistency.
- Keep aggregates small; large ones cause lock contention and lost updates.
- Not every app needs a rich domain model: for CRUD-heavy areas a layered design with
  validation is simpler.

## Common mistakes

- Domain classes importing Prisma or Express (RNP-006).
- An "anemic" model: data classes with all rules in services.

## Examples

**An aggregate that guards its rules:**

```ts
export class Order {
  private constructor(
    readonly id: string,
    private status: 'new' | 'paid' | 'shipped',
  ) {}

  ship() {
    if (this.status !== 'paid') throw new Error('Only paid orders can be shipped');
    this.status = 'shipped';
  }
}
```
