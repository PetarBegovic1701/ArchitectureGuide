---
id: renders
kind: relation
title: renders
summary: UI composition — a page or component renders another component. Only React code renders UI.
level: beginner
tracks: [foundations]
tags: [react, components]
related: [react.component, react.route, react.layout, navigates]
references:
  - title: React docs — Describing the UI
    url: https://react.dev/learn/describing-the-ui
---

## Beginner

`Page renders Component` means the page shows the component as part of its screen: the
product page renders a `ProductCard` and an `AddToCartButton`.

## Intermediate

- Draw `renders` for the components that matter to the design (shared ones, heavy ones),
  not every `<div>`.
- Data flows down through props; events flow up through callbacks.

## Senior

- Deep render trees that pass props through many levels suggest a hook or context; wide
  trees that re-render on every keystroke suggest splitting state.

## Common mistakes

- Backend shapes that "render" (this tool refuses it).

## Examples

**A page rendering components:**

```tsx
export function ProductPage({ product }: { product: Product }) {
  return <ProductCard {...product} onAdd={() => addToCart(product.id)} />;
}
```
