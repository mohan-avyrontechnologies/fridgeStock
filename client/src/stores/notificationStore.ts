import { create } from 'zustand';
import { api } from '../api/client';
import type { AppNotification } from '@cook-first/shared';
import { useAuthStore } from './authStore';

interface NotificationState {
  items: AppNotification[];
  total: number;
  unread: number;
  loading: boolean;
  fetchUnread: () => Promise<void>;
  fetchAll: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  items: [],
  total: 0,
  unread: 0,
  loading: false,

  async fetchUnread() {
    try {
      const { unread } = await api.unreadCount();
      set({ unread });
    } catch {
      // Reminders are secondary; the inventory views never depend on them.
    }
  },

  async fetchAll() {
    set({ loading: true });
    try {
      const page = await api.notifications();
      set({ items: page.items, total: page.total, unread: page.unread, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async loadMore() {
    const page = await api.notifications(get().items.length);
    set({ items: [...get().items, ...page.items], total: page.total, unread: page.unread });
  },

  async markRead(id) {
    const updated = await api.markRead(id);
    set({
      items: get().items.map((n) => (n.id === id ? updated : n)),
      unread: Math.max(0, get().unread - 1),
    });
  },

  async markAllRead() {
    await api.markAllRead();
    const now = new Date().toISOString();
    set({ items: get().items.map((n) => ({ ...n, readAt: n.readAt ?? now })), unread: 0 });
  },
}));

useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useNotificationStore.setState({ items: [], total: 0, unread: 0 });
});
