import type { LearnedLifespan } from '@cook-first/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { useAuthStore } from './authStore';

interface SuggestionState {
  /** Lifespans this user usually sets, learned by the server from their own items. */
  learned: LearnedLifespan[];
  load: () => Promise<void>;
}

export const useSuggestionStore = create<SuggestionState>()((set) => ({
  learned: [],
  async load() {
    try {
      set({ learned: (await api.learnedLifespans()).items });
    } catch {
      // Suggestions are optional; the reference list still works without them.
    }
  },
}));

useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useSuggestionStore.setState({ learned: [] });
});
