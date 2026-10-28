---
id: react.design-system
kind: concept
title: UI kit / design system
summary: A shared library of components and design rules (buttons, inputs, dialogs, colors, spacing) so every screen looks and behaves the same.
level: intermediate
tracks: [foundations]
tags: [design-system, ui-kit, shadcn, storybook]
related: [react.component, react.feature, depends-on]
references:
  - title: shadcn/ui — Introduction
    url: https://ui.shadcn.com/docs
  - title: Storybook — Why Storybook
    url: https://storybook.js.org/docs/get-started/why-storybook
---

## Beginner

A **design system** is a box of ready-made parts — buttons, inputs, dialogs, tables —
plus rules for colors, spacing and type. Every screen uses the same parts, so the app
looks consistent and new screens are faster to build.

It is often its own package (`@shop/ui`) that features depend on.

## Intermediate

- Build on accessible primitives (Radix, React Aria) instead of hand-rolling dialogs and
  menus.
- Design tokens (CSS variables) for colors and spacing make themes and dark mode cheap.
- Document components in Storybook with their states (loading, error, disabled).

## Senior

- Version the kit and release it like an API; breaking changes need migration notes.
- Keep business logic out: the kit knows "Button", not "BuyButton".
- Measure adoption; a kit nobody uses is a cost, not an asset.

## Common mistakes

- Putting feature logic into kit components.
- Forking a component instead of extending it with a variant.

## Examples

**A themed button using design tokens:**

```tsx
export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      style={{ background: 'var(--color-accent)', padding: 'var(--space-2) var(--space-3)' }}
    />
  );
}
```
