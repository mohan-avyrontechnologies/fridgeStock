import { create } from 'zustand';
import { describeError } from '../lib/errors';
import { api } from '../api/client';
import type {
  ActiveFoodItem,
  BulkCreateInput,
  FoodInput,
  FoodItem,
  FoodList,
  MoveFoodInput,
  OpenFoodInput,
  UsageAction,
} from '@fridgestock/shared';
import { useAuthStore } from './authStore';

interface FoodState {
  inventory: FoodList | null;
  fridgeStock: ActiveFoodItem[] | null;
  loading: boolean;
  error: string | null;
  /** Reloads the prioritised inventory and FridgeStock list together. */
  refresh: () => Promise<void>;
  add: (input: FoodInput) => Promise<FoodItem>;
  update: (id: string, input: Partial<FoodInput>) => Promise<FoodItem>;
  act: (id: string, action: UsageAction, quantity?: number) => Promise<void>;
  /** Reverses the item's most recent action (offered as "Undo" for a few seconds). */
  undo: (id: string) => Promise<FoodItem>;
  addBulk: (input: BulkCreateInput) => Promise<FoodItem[]>;
  addFavourite: (favouriteId: string) => Promise<FoodItem>;
  open: (id: string, input: OpenFoodInput) => Promise<FoodItem>;
  undoOpen: (id: string) => Promise<FoodItem>;
  move: (id: string, input: MoveFoodInput) => Promise<FoodItem>;
  reset: () => void;
}

/** The items after an action: closed ones are gone, a partly used one has less left. */
function reduceItems(items: ActiveFoodItem[], id: string, action: UsageAction, quantity?: number): ActiveFoodItem[] {
  return items.flatMap((item) => {
    if (item.id !== id) return [item];
    if (action === 'PARTIALLY_USED' && quantity !== undefined && quantity < item.quantity) {
      return [{ ...item, quantity: item.quantity - quantity }];
    }
    return [];
  });
}

/** The inventory after an action, with the urgency counts kept in step. */
function withoutOrReduced(list: FoodList, id: string, action: UsageAction, quantity?: number): FoodList {
  const items = reduceItems(list.items, id, action, quantity);
  if (items.length === list.items.length) return { ...list, items };
  const gone = list.items.find((item) => item.id === id);
  const summary = gone
    ? { ...list.summary, [gone.urgency]: list.summary[gone.urgency] - 1, total: list.summary.total - 1 }
    : list.summary;
  return { ...list, items, summary };
}

export const useFoodStore = create<FoodState>()((set, get) => ({
  inventory: null,
  fridgeStock: null,
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const [inventory, fridgeStock] = await Promise.all([api.listFoods(), api.fridgeStock()]);
      set({ inventory, fridgeStock: fridgeStock.items, loading: false });
    } catch (err) {
      set({ loading: false, error: describeError(err, 'load your food') });
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
    // Optimistic: the item leaves (or shrinks in) the lists at once; if the server refuses, it comes back.
    const before = { inventory: get().inventory, fridgeStock: get().fridgeStock };
    set({
      inventory: before.inventory && withoutOrReduced(before.inventory, id, action, quantity),
      fridgeStock: before.fridgeStock && reduceItems(before.fridgeStock, id, action, quantity),
    });
    try {
      if (action === 'REMOVED') await api.removeFood(id);
      else if (action === 'WASTED') await api.wasteFood(id);
      else await api.useFood(id, action === 'PARTIALLY_USED' ? quantity : undefined);
    } catch (error) {
      set(before);
      throw error;
    }
    await get().refresh();
  },

  async undo(id) {
    const food = await api.undo(id);
    await get().refresh();
    return food;
  },

  async addBulk(input) {
    const { items } = await api.bulkCreate(input);
    void get().refresh();
    return items;
  },

  async addFavourite(favouriteId) {
    const food = await api.addFavourite(favouriteId);
    void get().refresh();
    return food;
  },

  async open(id, input) {
    const food = await api.openFood(id, input);
    void get().refresh();
    return food;
  },

  async undoOpen(id) {
    const food = await api.undoOpen(id);
    void get().refresh();
    return food;
  },

  async move(id, input) {
    const food = await api.moveFood(id, input);
    void get().refresh();
    return food;
  },

  reset() {
    set({ inventory: null, fridgeStock: null, error: null });
  },
}));

// Never show one account's food to the next person who signs in on this device.
useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useFoodStore.getState().reset();
});
