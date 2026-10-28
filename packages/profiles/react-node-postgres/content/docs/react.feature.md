---
id: react.feature
kind: concept
title: Feature module (frontend)
summary: A folder that holds everything for one feature — components, hooks, state and API calls — with a small public entry point.
level: intermediate
tracks: [foundations, patterns]
tags: [feature-sliced-design, folders, modules]
related: [pattern.feature-sliced, react.component, react.hook, react.client-store, depends-on]
references:
  - title: Feature-Sliced Design — Overview
    url: https://feature-sliced.design/docs/get-started/overview
  - title: Bulletproof React — Project structure
    url: https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
---

## Beginner

As an app grows, putting all components in one `components/` folder and all hooks in one
`hooks/` folder makes it hard to see what belongs together. A **feature module** groups
code by **what it does for the user**: `features/cart`, `features/checkout`,
`features/search`.

Inside a feature you find its components, hooks, state and API calls. Other code uses the
feature only through its `index.ts`.

## Intermediate

- **Public API:** export only what pages need (`CartButton`, `useCart`); keep the rest
  private. A lint rule can block deep imports like `features/cart/internal/x`.
- **Features do not import each other.** If two features need the same thing, move it
  down to a shared layer (an "entity" in Feature-Sliced Design) or let the page connect
  them through props.
- Pages (routes) compose features.

## Senior

- The value is in the **dependency direction**, not in folder names: pages → features →
  entities → shared. Enforce it with `eslint-plugin-boundaries` or Steiger; this tool's
  FSD rules check the model.
- A feature is a unit of ownership and deletion: removing a feature should mean deleting
  one folder and one route entry.
- Server data stays in the server-state cache, keyed by entity, not copied into feature
  stores.

## When to use

- Apps with more than a handful of screens or more than one developer.

## Common mistakes

- Feature A importing from feature B's internals.
- A "shared" folder that slowly becomes the whole app.
- Duplicating server data in each feature's store.

## Examples

**A feature's public entry point:**

```ts
// features/cart/index.ts — the only file other code imports
export { CartButton } from './ui/CartButton';
export { useCart } from './model/useCart';
```
