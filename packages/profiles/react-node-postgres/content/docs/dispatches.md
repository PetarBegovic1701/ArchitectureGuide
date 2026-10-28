---
id: dispatches
kind: relation
title: dispatches
summary: Starts an action — dispatch(addToCart(item)), or calling a Zustand action. Pages, components, hooks and effects dispatch actions.
level: beginner
tracks: [state-management]
tags: [redux, actions, events]
related: [react.action, react.effect, react.component, updates]
references:
  - title: Redux — Dispatching actions
    url: https://redux.js.org/tutorials/fundamentals/part-3-state-actions-reducers#dispatching-actions
---

## Beginner

`Button dispatches addToCart` means clicking the button starts the `addToCart` action,
which then changes the store.

An **effect** can dispatch too: "when the page opens, dispatch `fetchOrder(id)`".

## Intermediate

- Dispatch from event handlers for user actions; from effects only for synchronization
  (page opened, ID changed).
- Thunks can dispatch other actions (pending, fulfilled, rejected).

## Senior

- Dispatching in render causes loops; dispatching in effects without the right
  dependencies dispatches too often.

## Common mistakes

- Dispatching in render.
- Effects that dispatch on every render.

## Examples

**Dispatch from a click and from an effect:**

```tsx
<button onClick={() => dispatch(itemAdded(product))}>Add</button>;

useEffect(() => {
  dispatch(fetchOrder(orderId));
}, [dispatch, orderId]);
```
