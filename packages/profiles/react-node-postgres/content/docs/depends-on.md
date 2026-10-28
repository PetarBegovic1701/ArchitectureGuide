---
id: depends-on
kind: relation
title: depends on
summary: A compile-time import — one module uses another's code. The direction of these arrows is the architecture.
level: beginner
tracks: [patterns]
tags: [imports, dependencies, layering]
related: [node.module, react.feature, implements, uses-port, group.layer]
references:
  - title: dependency-cruiser — Rules reference
    url: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
  - title: Robert C. Martin — The dependency rule (Clean Architecture)
    url: https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
---

## Beginner

`A depends on B` means A's code imports B's code. If B changes, A may have to change too.
Unlike `calls`, nothing happens at runtime over the network; it is about the code.

## Intermediate

- Arrows should point toward stable things: features → shared, handlers → use cases →
  domain.
- Browser code must not depend on server code (this tool refuses it); share types through
  a contract package.
- Cycles (A → B → A) mean the boundary is wrong.

## Senior

- Enforce the intended direction in CI (dependency-cruiser, Nx, ESLint boundaries); this
  tool can generate those rules from the model in a later phase.
- Domain → infrastructure dependencies (RNP-006) are the classic violation.

## Common mistakes

- Import cycles.
- The frontend importing server packages to "share types".

## Examples

**A dependency-cruiser rule: domain must not import infrastructure:**

```json
{
  "name": "domain-is-pure",
  "severity": "error",
  "from": { "path": "^src/domain" },
  "to": { "path": "^src/infrastructure" }
}
```
