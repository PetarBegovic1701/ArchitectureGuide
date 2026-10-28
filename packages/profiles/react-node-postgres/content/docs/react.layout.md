---
id: react.layout
kind: concept
title: Layout route
summary: A route that draws shared UI — header, menu, footer — around its child routes, so every page in an area looks the same.
level: beginner
tracks: [foundations]
tags: [react-router, outlet, shell]
related: [react.route, react.component, renders]
references:
  - title: React Router — Layout routes
    url: https://reactrouter.com/start/framework/routing#layout-routes
---

## Beginner

Most apps have parts that stay the same while the content changes: the header, the side
menu, the footer. A **layout route** draws these once and leaves a hole (an "outlet")
where the current page appears.

`/account/profile`, `/account/orders` and `/account/settings` can share an account
layout with tabs; only the content under the tabs changes.

## Intermediate

- Layouts nest: an app shell layout, then an account layout inside it.
- A layout is a good place for things every child needs: a "signed in?" redirect,
  breadcrumbs, a shared error boundary.
- The layout stays mounted while the user moves between its children, so its state
  (an open menu) is kept.

## Senior

- Put error boundaries and suspense boundaries at layout level so one failing page does
  not blank the whole app.
- Avoid loading data in a layout that only one child needs; it delays every child.
- Layout auth redirects are UX, not security: the API decides.

## Common mistakes

- Repeating the header in every page component.
- Loading heavy data in a layout and slowing down all pages below it.

## Examples

**An account layout with an outlet (React Router):**

```tsx
import { NavLink, Outlet } from 'react-router';

export function AccountLayout() {
  return (
    <div>
      <nav>
        <NavLink to="profile">Profile</NavLink> <NavLink to="orders">Orders</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
```
