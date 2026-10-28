---
id: react.effect
kind: concept
title: Effect (useEffect)
summary: Code that runs after React renders, to sync with something outside React — a subscription, a timer, the document title, or dispatching an action when an ID changes.
level: intermediate
tracks: [state-management]
tags: [useEffect, side-effects, lifecycle]
related: [react.action, react.hook, react.server-state, dispatches, fetches-via]
references:
  - title: React docs — Synchronizing with effects
    url: https://react.dev/learn/synchronizing-with-effects
  - title: React docs — You might not need an effect
    url: https://react.dev/learn/you-might-not-need-an-effect
quiz:
  - question: An effect opens a WebSocket for live prices. What must it also do?
    options:
      [
        Nothing — React closes it,
        Return a cleanup function that closes the socket,
        Store the socket in localStorage,
        Run on every render,
      ]
    answer: 1
    explanation: The cleanup runs when the component unmounts or the dependencies change, so the old connection is closed and no updates arrive for a page that is gone.
---

## Beginner

Rendering should only compute what to show. Some things must happen **after** the screen
is drawn: start a timer, open a WebSocket, update the page title, or dispatch an action
that loads an order when the page opens. That is what an **effect** (`useEffect`) is for.

You give the effect a list of **dependencies**: it runs again when one of them changes
(`[orderId]`), and only once when the list is empty.

## Intermediate

- Return a **cleanup** function to stop what the effect started (close the socket, clear
  the timer). React calls it before the next run and on unmount.
- In development, React's Strict Mode runs effects twice on purpose to find missing
  cleanups.
- Many effects are not needed: derived values are computed during render; reactions to a
  click belong in the click handler.
- Fetching in an effect works, but you must handle loading, errors, races and caching
  yourself; a server-state cache does this.

## Senior

- Race conditions: if `orderId` changes quickly, an older response can arrive last. Use an
  `ignore` flag or `AbortController` in the cleanup.
- Effects that set state which triggers the same effect cause render loops; check the
  dependency list and move logic to events where possible.
- An effect that dispatches a thunk on mount is a common Redux pattern; with a
  server-state cache, a query hook replaces both.

## Common mistakes

- Missing cleanup for subscriptions and timers (memory leaks, duplicate listeners).
- Missing dependencies, so the effect uses stale values.
- Using an effect to compute derived data.
- Fetching without handling a response that arrives after the user moved on.

## Examples

**Load an order when the page opens, and ignore stale responses:**

```tsx
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { fetchOrder } from './ordersSlice';

export function OrderPage({ orderId }: { orderId: string }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const request = dispatch(fetchOrder(orderId));
    return () => request.abort(); // a newer orderId cancels the old request
  }, [dispatch, orderId]);
  return null;
}
```
