---
id: gen.actor
kind: concept
title: User / actor
summary: A person or role that uses the system — customer, admin, support agent. Diagrams start with who uses the system and why.
level: beginner
tracks: [foundations]
tags: [c4, context, users]
related: [react.app, gen.external, calls]
references:
  - title: C4 model — System context diagram
    url: https://c4model.com/diagrams/system-context
---

## Beginner

An **actor** is someone who uses the system: a customer who buys, an admin who manages
products, a support agent who refunds orders. Start every diagram with the actors; they
explain why everything else exists.

Different actors often use different apps (shop vs admin) and need different permissions.

## Intermediate

- Name actors by role, not by person ("Support agent", not "Anna").
- Actors call **apps**, not databases. If an actor talks to an external tool (a payment
  page), draw that too.
- Roles on actors map to roles in authorization (RBAC).

## Senior

- Machine actors (partners, schedulers, other systems) belong here too; they have
  different auth (API keys, client credentials) and rate limits.
- Tours drafted by this tool start from actors and follow their calls.

## Common mistakes

- Diagrams with no actors, so nobody knows who the system is for.

## Examples

**Roles as data for authorization:**

```ts
type Role = 'customer' | 'admin' | 'support';
const can = { refund: ['support', 'admin'], editProducts: ['admin'] } satisfies Record<
  string,
  Role[]
>;
```
