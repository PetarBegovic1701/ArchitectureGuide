---
id: navigates
kind: relation
title: navigates to
summary: UI navigation — a link, button or redirect takes the user from one page to another.
level: beginner
tracks: [foundations]
tags: [routing, links, ux]
related: [react.route, react.layout, renders]
references:
  - title: React Router — Navigating
    url: https://reactrouter.com/start/framework/navigating
---

## Beginner

`Cart navigates to Checkout` means the user can go from the cart page to the checkout page
(a link, a button, or a redirect after an action).

## Intermediate

- Users navigate to **routes**, not components (this tool refuses navigation to a
  component).
- Navigation arrows show the main user journeys; use them for tours and onboarding.

## Senior

- Redirects after mutations (POST → redirect → GET) avoid double submission on reload.
- Deep links must work: every route should load on its own.

## Common mistakes

- Navigating to a component instead of a route.

## Examples

**Navigate after placing an order:**

```tsx
const navigate = useNavigate();
await placeOrder.mutateAsync(input);
navigate(`/orders/${order.id}`);
```
