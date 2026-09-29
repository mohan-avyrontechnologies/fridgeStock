import { create } from 'zustand';
import { api } from '../api/client';
import type { ActiveFoodItem, FoodInput, FoodItem, FoodList, UsageAction } from '@cook-first/shared';
import { useAuthStore } from './authStore';

interface FoodState {
  inventory: FoodList | null;
  cookFirst: ActiveFoodItem[] | null;
  loading: boolean;
  error: string | null;
  /** Reloads the prioritised inventory and Cook First list together. */
  refresh: () => Promise<void>;
  add: (input: FoodInput) => Promise<FoodItem>;
  update: (id: string, input: Partial<FoodInput>) => Promise<FoodItem>;
  act: (id: string, action: UsageAction, quantity?: number) => Promise<void>;
  reset: () => void;
}

export const useFoodStore = create<FoodState>()((set, get) => ({
  inventory: null,
  cookFirst: null,
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const [inventory, cookFirst] = await Promise.all([api.listFoods(), api.cookFirst()]);
      set({ inventory, cookFirst: cookFirst.items, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Could not load your food.' });
    }
  },

  async add(input) {
    const food = await api.createFood(input);
    void get().refresh();
    return food;
  },

  async update(id, input) {
    const food = await api.updateFood(id, input);
    void get().refresh();
    return food;
  },

  async act(id, action, quantity) {
    if (action === 'REMOVED') await api.removeFood(id);
    else if (action === 'WASTED') await api.wasteFood(id);
    else await api.useFood(id, action === 'PARTIALLY_USED' ? quantity : undefined);
    await get().refresh();
  },

  reset() {
    set({ inventory: null, cookFirst: null, error: null });
  },
}));

// Never show one account's food to the next person who signs in on this device.
useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useFoodStore.getState().reset();
});
