import { Navigate, Outlet, Route, Routes } from 'react-router';
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
import { PlanPage } from './pages/PlanPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { useAuthStore } from './stores/authStore';

function RequireAuth() {
  const token = useAuthStore((s) => s.token);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

function GuestOnly() {
  const token = useAuthStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <Outlet />;
}

export function App() {
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
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
