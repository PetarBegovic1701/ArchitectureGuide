---
id: group.team
kind: concept
title: Team boundary
summary: The elements one team owns. Ownership boundaries should match architecture boundaries, or every change needs a meeting.
level: intermediate
tracks: [patterns]
tags: [ownership, conways-law, teams]
related: [group.context, node.module, pg.schema]
references:
  - title: Martin Fowler — Conway's law
    url: https://martinfowler.com/bliki/ConwaysLaw.html
  - title: Team Topologies — Key concepts
    url: https://teamtopologies.com/key-concepts
---

## Beginner

A **team boundary** shows who owns what. When a team owns a service, its schema and its
frontend feature, it can change them without waiting for others.

## Intermediate

- Ownership should follow the architecture: one owner per schema, per module, per
  service.
- Shared things (a UI kit, a gateway config) need an explicit owner too.

## Senior

- Conway's law: systems mirror the communication structure of the teams that build them.
  Use it on purpose: shape teams around the boundaries you want.
- Cross-team arrows are coordination costs; few and stable is the goal.

## Common mistakes

- Two teams editing the same tables.

## Examples

**A CODEOWNERS file that matches the boundaries:**

```bash
/services/orders/   @shop/checkout-team
/web/src/features/cart/   @shop/checkout-team
/services/catalog/  @shop/catalog-team
```
