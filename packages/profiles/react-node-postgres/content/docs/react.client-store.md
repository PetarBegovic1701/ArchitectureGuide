---
id: react.client-store
kind: concept
title: Client state store (Redux, Zustand, Context)
summary: Holds state that many components share in the browser — cart, filters, signed-in user flags. Components read it; actions change it.
level: beginner
tracks: [state-management]
tags: [redux, redux-toolkit, zustand, context, jotai]
related: [react.action, react.server-state, react.hook, uses-state, updates, dispatches]
references:
  - title: Redux — Redux essentials, part 1
    url: https://redux.js.org/tutorials/essentials/part-1-overview-concepts
  - title: Zustand — Introduction
    url: https://zustand.docs.pmnd.rs/getting-started/introduction
  - title: React docs — Choosing the state structure
    url: https://react.dev/learn/choosing-the-state-structure
quiz:
  - question: Which data belongs in a client store rather than a server-state cache?
    options:
      [
        The list of products from the API,
        The orders of the signed-in user,
        Whether the cart drawer is open and the filters the user picked,
        The current stock of a product,
      ]
    answer: 2
    explanation: UI state that exists only in the browser belongs in a client store. Data the server owns belongs in a server-state cache.
---

## Beginner

Some state is needed in many places at once. The cart count in the header, the cart page
and the checkout must agree. A **store** keeps that state in one place:

- components **read** it (and re-render when it changes),
- **actions** change it (`addToCart(item)`), and nothing else does.

Common libraries: **Redux Toolkit** (actions and reducers), **Zustand** (a small store
with functions), React **Context** (for values that rarely change, like the theme).

## Intermediate

- Keep the store for state the **browser owns**: UI flags, drafts, selections, the cart
  before checkout, filters. Data from the API belongs in a server-state cache.
- Read with **selectors** (`useStore((s) => s.items.length)`), so a component re-renders
  only when its slice changes.
- Derive values (totals) instead of storing them.
- `persist` to `localStorage` is fine for preferences and drafts, never for tokens.

## Senior

- A global store that mirrors server tables is a cache you now maintain by hand:
  loading flags, errors, staleness, invalidation. That is what RNP-012 flags.
- Context re-renders every consumer on each change; split contexts or use a store with
  selectors for frequently changing values.
- Model actions as events ("itemAdded"), not setters, when several parts of the state
  react to them; it keeps reducers testable and the history readable in devtools.

## Analogy

A whiteboard in the office: everyone looks at the same board, and only people with a
marker (actions) may change it.

## When to use

- State shared by distant components: cart, filters, wizard steps, UI preferences.

## When not to use

- Data from the server (use a server-state cache).
- State one component needs (use `useState`).

## Common mistakes

- Fetching in an effect and copying the result into the store.
- One giant store for everything.
- Storing derived values that drift out of sync.
- Persisting auth tokens to `localStorage`.

## Examples

**A Redux Toolkit slice: the store and its actions:**

```ts
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

type Item = { id: string; price: number; quantity: number };

const cart = createSlice({
  name: 'cart',
  initialState: { items: [] as Item[] },
  reducers: {
    itemAdded(state, action: PayloadAction<Item>) {
      state.items.push(action.payload);
    },
    itemRemoved(state, action: PayloadAction<string>) {
      state.items = state.items.filter((i) => i.id !== action.payload);
    },
  },
});

export const { itemAdded, itemRemoved } = cart.actions;
export default cart.reducer;
```

**The same with Zustand:**

```ts
import { create } from 'zustand';

type Cart = { items: { id: string }[]; add: (id: string) => void };

export const useCartStore = create<Cart>((set) => ({
  items: [],
  add: (id) => set((s) => ({ items: [...s.items, { id }] })),
}));
```
