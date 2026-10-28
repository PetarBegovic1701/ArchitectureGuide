import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

// RNP-012: server data fetched into the client store, while TanStack Query is there for it.
export const loadCart = createAsyncThunk('cart/load', async () => (await fetch('/api/cart')).json());

export const cartSlice = createSlice({ name: 'cart', initialState: { items: [] as string[] }, reducers: {} });
