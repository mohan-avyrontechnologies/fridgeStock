import type { AppNotification } from '@cook-first/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { useAuthStore } from './authStore';

interface NotificationState {
  items: AppNotification[];
  total: number;
  unread: number;
  loading: boolean;
  error: boolean;
  fetchUnread: () => Promise<void>;
  /**
   * Called when the Reminders screen opens: loads the feed, then marks every
   * delivered reminder as read (readAt stays empty until this moment). The
   * list keeps its unread highlight for this visit so new ones stand out.
   */
  openFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  items: [],
  total: 0,
  unread: 0,
  loading: false,
  error: false,

  async fetchUnread() {
    try {
      const { unread } = await api.unreadCount();
      set({ unread });
    } catch {
      // Reminders are secondary; the inventory views never depend on them.
    }
  },

  async openFeed() {
    set({ loading: true, error: false });
    try {
      const page = await api.notifications();
      set({ items: page.items, total: page.total, loading: false });
      if (page.unread > 0) await api.markAllRead();
      set({ unread: 0 });
    } catch {
      set({ loading: false, error: true });
    }
  },

  async loadMore() {
    const page = await api.notifications(get().items.length);
    set({ items: [...get().items, ...page.items], total: page.total });
    if (page.unread > 0) await api.markAllRead();
  },
}));

useAuthStore.subscribe((state, prev) => {
  if (state.token !== prev.token) useNotificationStore.setState({ items: [], total: 0, unread: 0 });
});
