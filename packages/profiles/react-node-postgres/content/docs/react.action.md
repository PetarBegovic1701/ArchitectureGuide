---
id: react.action
kind: concept
title: Action / thunk
summary: A named change to client state. UI code dispatches it; the store's reducer applies it. A thunk can call the API first, then dispatch the result.
level: intermediate
tracks: [state-management]
tags: [redux, thunk, createAsyncThunk, zustand]
related: [react.client-store, react.effect, react.api-client, dispatches, updates]
references:
  - title: Redux — Actions and reducers
    url: https://redux.js.org/tutorials/fundamentals/part-3-state-actions-reducers
  - title: Redux Toolkit — createAsyncThunk
    url: https://redux-toolkit.js.org/api/createAsyncThunk
---

## Beginner

An **action** describes something that should change in the store: "add this item to the
cart", "set the filter to shoes". UI code **dispatches** the action; the store **updates**
its state.

Because every change goes through a named action, you can see in the developer tools what
happened and in which order.

A **thunk** is an action that does work first, for example calls the API, and then
dispatches the result.

## Intermediate

- In Redux Toolkit, `createSlice` generates actions from reducers; `createAsyncThunk`
  generates `pending`, `fulfilled` and `rejected` actions around an async call.
- In Zustand, actions are the functions on the store (`add`, `setFilter`).
- Name actions after events (`itemAdded`) rather than setters (`setItems`).
- Keep reducers pure: no API calls, no random values, no dates; do those in thunks.

## Senior

- A thunk that loads server data into a client store re-implements caching, loading and
  error state by hand. With a server-state cache in the app, prefer a query (RNP-012).
  Thunks remain right for workflows: multi-step checkout, optimistic UI coordination,
  analytics.
- Make thunks cancel or ignore stale responses (request IDs, `AbortController`) so a slow
  old response cannot overwrite a newer one.
- Actions are a log: in big apps, listeners/middleware can react to them (sync to
  `localStorage`, analytics) without coupling components.

## Common mistakes

- API calls inside reducers.
- Thunks that store server lists in Redux next to a TanStack Query cache.
- Ignoring the `rejected` case, so errors leave a spinner forever.

## Examples

**A thunk that loads orders and the reducer cases for it:**

```ts
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api } from '../api';

export const fetchOrders = createAsyncThunk('orders/fetch', () => api.get('/orders'));

const orders = createSlice({
  name: 'orders',
  initialState: { list: [] as unknown[], status: 'idle' as 'idle' | 'loading' | 'failed' },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchOrders.pending, (s) => void (s.status = 'loading'));
    b.addCase(fetchOrders.fulfilled, (s, a) => {
      s.status = 'idle';
      s.list = a.payload as unknown[];
    });
    b.addCase(fetchOrders.rejected, (s) => void (s.status = 'failed'));
  },
});

export default orders.reducer;
```
