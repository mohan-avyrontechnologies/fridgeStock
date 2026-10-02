import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell';
import { useAuthStore } from '../stores/authStore';

/** Renders a page inside the signed-in shell at the given path. */
export function renderSignedIn(path: string, element: ReactElement, routePath = path) {
  useAuthStore.setState({
    token: 'test-token',
    user: {
      id: 'u1',
      name: 'Asha Rao',
      email: 'asha@example.com',
      timeZone: 'UTC',
      currency: 'USD',
      notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
      reminderDelivery: { mode: 'DIGEST', hour: 8 },
    },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path={routePath} element={element} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
