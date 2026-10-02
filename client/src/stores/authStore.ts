import { create } from 'zustand';
import { useSyncExternalStore } from 'react';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api, configureApi } from '../api/client';
import { platform } from '../platform';
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
    (set, get) => ({
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
        // Stop push reminders for this account on this device. Uses the token
        // before it is cleared; a failure never blocks signing out.
        const { token } = get();
        if (token) void platform.push.turnOff(token).catch(() => {});
        set({ token: null, user: null });
      },
      setUser(user) {
        set({ user });
      },
    }),
    // localStorage in a browser; the Keychain or Keystore in the apps (see platform/native/storage.ts).
    { name: 'cook-first-auth', storage: createJSONStorage(() => platform.storage) },
  ),
);

/**
 * Whether the saved login has been read. In a browser it is read at once; in the apps secure storage is
 * asynchronous, so the app waits for it rather than showing the login screen for a moment.
 */
export function useAuthHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useAuthStore.persist.onFinishHydration(onChange),
    () => useAuthStore.persist.hasHydrated(),
  );
}

configureApi({
  getToken: () => useAuthStore.getState().token,
  // An expired or revoked token signs the user out instead of failing silently.
  onUnauthenticated: () => useAuthStore.getState().logout(),
});
