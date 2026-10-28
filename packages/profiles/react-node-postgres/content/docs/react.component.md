---
id: react.component
kind: concept
title: Shared component
summary: A reusable piece of UI — a product card, a date picker — used by several pages. It gets data through props and stays free of page-specific logic.
level: beginner
tracks: [foundations]
tags: [react, components, props]
related: [react.design-system, react.route, renders, react.hook]
references:
  - title: React docs — Your first component
    url: https://react.dev/learn/your-first-component
  - title: React docs — Passing props to a component
    url: https://react.dev/learn/passing-props-to-a-component
quiz:
  - question: A ProductCard is used on three pages. Where should it get the product it shows?
    options:
      [
        It fetches the product itself by reading the URL,
        From props passed by the page or feature,
        From a global variable,
        From localStorage,
      ]
    answer: 1
    explanation: Props keep the component reusable and easy to test; the page decides which data it shows.
---

## Beginner

A **component** is a function that returns a piece of UI. A **shared component** is one
that several pages use: a `ProductCard` on the home page, the search page and the
recommendations.

It receives what it needs as **props** (`<ProductCard product={p} />`) instead of
fetching it or reading the URL itself. That is what makes it reusable.

## Intermediate

- Keep shared components presentational: props in, events out (`onAddToCart`).
- Components **render** other components; complex logic moves into custom hooks.
- Co-locate a component's styles and tests with it.
- A component that knows about one specific page is not shared; keep it in that page's
  feature.

## Senior

- Stable props and memoization matter only where profiling shows re-render cost; start
  simple.
- Accessibility is part of the component contract: labels, keyboard support, focus.
- When several apps share components, move them into a UI kit package with its own
  versioning.

## Common mistakes

- Shared components that fetch data or read global stores, so they only work in one place.
- Copy-pasting a component instead of adding a prop.
- Components that do everything (giant props objects with many boolean flags).

## Examples

**A presentational component with props and an event:**

```tsx
type Props = { name: string; price: number; onAdd: () => void };

export function ProductCard({ name, price, onAdd }: Props) {
  return (
    <article>
      <h3>{name}</h3>
      <p>{price.toFixed(2)} €</p>
      <button onClick={onAdd}>Add to cart</button>
    </article>
  );
}
```
