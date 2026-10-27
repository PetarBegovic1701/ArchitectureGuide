---
id: pattern.feature-sliced
kind: pattern
title: Feature-Sliced Design
summary: React code is split into layers (pages, widgets, features, entities, shared) and slices. Code imports only from layers below its own.
level: intermediate
tracks: [patterns, state-management]
tags: [react, folders, boundaries, fsd]
related: [react.feature, react.app, react.server-state, react.api-client, depends-on]
references:
  - title: Feature-Sliced Design — Overview
    url: https://feature-sliced.design/docs/get-started/overview
  - title: Feature-Sliced Design — Layers
    url: https://feature-sliced.design/docs/reference/layers
  - title: TanStack Query — Overview
    url: https://tanstack.com/query/latest/docs/framework/react/overview
quiz:
  - question: The Cart feature and the Checkout feature both need to show a product's price. Where should the price component go?
    options:
      - In Cart, and Checkout imports it from Cart
      - In the Product entity (or shared), and both import it from there
      - Copied into both features
      - In the page
    answer: 1
    explanation: Features must not import each other. Shared things move down a layer, here to the Product entity.
---

## Beginner

Big React apps get messy when any file can import any other. Feature-Sliced Design
gives every piece of code a place, in layers from top to bottom:

- **pages**: whole screens, composed of the layers below.
- **widgets**: big blocks used on pages (header, sidebar).
- **features**: things the user does (add to cart, search).
- **entities**: business things (user, product) and how to show them.
- **shared**: UI kit, API client, helpers.

The one rule: **import only from layers below you**. A feature may use entities and
shared code, never a page or another feature.

## Intermediate

- Each slice (`features/cart`) exposes a public API through `index.ts`; other code
  imports only from it.
- Server data lives in a server-state cache (TanStack Query) via entity hooks such as
  `useProduct(id)`, not in a global store.
- Features talk to each other through the page that composes them (props, callbacks),
  or through shared state in an entity.
- Enforce the direction with ESLint (`eslint-plugin-boundaries` or Steiger, the FSD
  linter).

## Senior

FSD makes deletion cheap: removing a feature folder should only break the pages that
use it. The cost is classification debates (feature or entity?); settle them with
examples in the team docs. Cross-imports between entities are sometimes unavoidable;
FSD allows them only through an explicit `@x` public API, which keeps them visible.
For small apps, a plain `pages / components / api` split is enough.

## Analogy

A department store: floors (layers) and departments (slices). Staff take stock from the
warehouse floors below, never from another department's shelves.

## Common mistakes

- `features/cart` importing from `features/checkout`.
- A huge `shared` folder that holds business logic.
- Deep imports into a slice's internals instead of its `index.ts`.

## Examples

**A page composes features; features use entities:**

```tsx
// pages/checkout/ui/CheckoutPage.tsx
import { CartSummary } from '@/features/cart';
import { PaymentForm } from '@/features/checkout';

export function CheckoutPage() {
  return (
    <>
      <CartSummary />
      <PaymentForm />
    </>
  );
}

// features/cart/ui/CartSummary.tsx
import { ProductPrice, useProduct } from '@/entities/product'; // lower layer: allowed
```
