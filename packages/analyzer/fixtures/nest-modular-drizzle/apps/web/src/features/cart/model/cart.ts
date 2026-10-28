import { create } from 'zustand';
import { request } from '../../../shared/api/http';

interface CartState {
  items: string[];
  add(id: string): void;
  checkout(): Promise<void>;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  add: (id) => set({ items: [...get().items, id] }),
  checkout: async () => {
    await request('/api/orders', { method: 'POST', body: JSON.stringify(get().items) });
    set({ items: [] });
  },
}));
