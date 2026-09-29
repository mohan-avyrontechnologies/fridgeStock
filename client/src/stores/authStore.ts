import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, configureApi } from '../api/client';
import type { User } from '@cook-first/shared';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      async login(email, password) {
        const { token, user } = await api.login({ email, password });
        set({ token, user });
      },
      async register(name, email, password) {
        const { token, user } = await api.register({ name, email, password });
        set({ token, user });
      },
      logout() {
        set({ token: null, user: null });
      },
      setUser(user) {
        set({ user });
      },
    }),
    { name: 'cook-first-auth' },
  ),
);

configureApi({
  getToken: () => useAuthStore.getState().token,
  // An expired or revoked token signs the user out instead of failing silently.
  onUnauthenticated: () => useAuthStore.getState().logout(),
});
