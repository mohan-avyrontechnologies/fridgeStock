import type { AiStatus } from '@cook-first/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { useAuthStore } from './authStore';

interface AiState {
  /** null until loaded; AI buttons are shown only when `status.enabled`. */
  status: AiStatus | null;
  load: () => Promise<void>;
}

export const useAiStore = create<AiState>()((set) => ({
  status: null,
  async load() {
    try {
      set({ status: await api.aiStatus() });
    } catch {
      set({ status: { enabled: false, dailyLimit: 0, usedToday: 0 } });
    }
  },
}));

useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useAiStore.setState({ status: null });
});
