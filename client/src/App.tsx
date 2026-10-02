import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router';
import { AppShell } from './components/AppShell';
import { AddFoodPage } from './pages/AddFoodPage';
import { BulkAddPage } from './pages/BulkAddPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CookFirstPage } from './pages/CookFirstPage';
import { DashboardPage } from './pages/DashboardPage';
import { FoodDetailPage } from './pages/FoodDetailPage';
import { HistoryPage } from './pages/HistoryPage';
import { HouseholdPage } from './pages/HouseholdPage';
import { InsightsPage } from './pages/InsightsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MealReminderPage } from './pages/MealReminderPage';
import { PlanPage } from './pages/PlanPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { SkeletonList } from './components/ui';
import { mealSnoozeToast } from './copy';
import { useReminderChime } from './lib/useReminderChime';
import { OPEN_PAGE_EVENT, PUSH_ACTION_DONE_EVENT, PUSH_RECEIVED_EVENT } from './platform/events';
import { useAuthHydrated, useAuthStore } from './stores/authStore';
import { useFoodStore } from './stores/foodStore';
import { useNotificationStore } from './stores/notificationStore';
import { useToastStore } from './stores/toastStore';

function RequireAuth() {
  const token = useAuthStore((s) => s.token);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

function GuestOnly() {
  const token = useAuthStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <Outlet />;
}

/** Where the Android shell leaves an address for a notification that started the app (MainActivity.java). */
type PendingWindow = Window & { __cookFirstPendingUrl?: string };

/** What the apps' notifications ask the screens to do (see platform/events.ts). Nothing happens in a browser. */
function useNativeEvents() {
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  useEffect(() => {
    const open = (event: Event) => {
      delete (window as PendingWindow).__cookFirstPendingUrl;
      navigate(String((event as CustomEvent).detail ?? '/'));
    };
    const received = () => void useNotificationStore.getState().fetchUnread();
    const handled = (event: Event) => {
      const action = (event as CustomEvent).detail;
      toast(
        action === 'USED' ? 'Marked as used' : action === 'SNOOZE_MEAL' ? mealSnoozeToast : 'Snoozed until tomorrow',
      );
      void useFoodStore.getState().refresh();
    };
    // A page handed over before this was listening (the app was started by tapping a notification).
    const pending = (window as PendingWindow).__cookFirstPendingUrl;
    if (pending) {
      delete (window as PendingWindow).__cookFirstPendingUrl;
      navigate(pending);
    }
    window.addEventListener(OPEN_PAGE_EVENT, open);
    window.addEventListener(PUSH_RECEIVED_EVENT, received);
    window.addEventListener(PUSH_ACTION_DONE_EVENT, handled);
    return () => {
      window.removeEventListener(OPEN_PAGE_EVENT, open);
      window.removeEventListener(PUSH_RECEIVED_EVENT, received);
      window.removeEventListener(PUSH_ACTION_DONE_EVENT, handled);
    };
  }, [navigate, toast]);
}

export function App() {
  useNativeEvents();
  useReminderChime();
  const hydrated = useAuthHydrated();
  // In the apps the saved login is read from secure storage first.
  if (!hydrated) return <SkeletonList />;
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/cook-first" element={<CookFirstPage />} />
          <Route path="/add" element={<AddFoodPage />} />
          <Route path="/add/bulk" element={<BulkAddPage />} />
          <Route path="/food/:id" element={<FoodDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/household" element={<HouseholdPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/shopping" element={<ShoppingPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/meal/:meal" element={<MealReminderPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
