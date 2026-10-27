import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { server } from '../mocks/server';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import { renderSignedIn } from './render';

/** Phase 6: appearance, data export and account deletion. The API is faked with MSW. */

const renderSettings = () => renderSignedIn('/settings', <SettingsPage />);

afterEach(() => {
  useThemeStore.getState().setTheme('system');
  vi.restoreAllMocks();
});

describe('appearance', () => {
  it('follows the device by default, and Light or Dark set the theme on the page', async () => {
    const user = userEvent.setup();
    renderSettings();
    const group = screen.getByRole('group', { name: 'Appearance' });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await user.click(within(group).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(within(group).getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(within(group).getByRole('button', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('remembers the choice on this device', async () => {
    const user = userEvent.setup();
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(JSON.parse(localStorage.getItem('fridgestock-theme')!).state.theme).toBe('dark');
  });
});

describe('download my data', () => {
  it('fetches the export and saves it as a JSON file', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_URL}/account/export`, () =>
        HttpResponse.json({ exportedAt: '2026-09-29T10:00:00.000Z', account: {}, foods: [] }),
      ),
    );
    const createUrl = vi.fn(() => 'blob:export');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalledOnce();
    expect(await screen.findByText('Your data was downloaded')).toBeInTheDocument();
  });

  it('says so when it cannot be prepared', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_URL}/account/export`, () => HttpResponse.json({}, { status: 500 })));
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText(/Couldn’t prepare your data/)).toBeInTheDocument();
  });
});

describe('delete my account', () => {
  it('asks for the password first and does nothing until it is typed', async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument();
  });

  it('shows the server’s message for a wrong password and stays signed in', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(`${API_URL}/account`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Password is incorrect.', field: 'password' } },
          { status: 400 },
        ),
      ),
    );
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.type(screen.getByLabelText('Enter your password to confirm'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(await screen.findByText('Password is incorrect.')).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('test-token');
  });

  it('deletes the account with the password and signs out', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.delete(`${API_URL}/account`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.type(screen.getByLabelText('Enter your password to confirm'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
    expect(body).toEqual({ password: 'correct horse' });
  });
});
