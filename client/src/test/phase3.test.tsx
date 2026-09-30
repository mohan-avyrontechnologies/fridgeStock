import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import * as push from '../lib/push';
import { server } from '../mocks/server';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

/** Phase 3: push reminders in Settings. The browser push layer (lib/push) is replaced by fakes. */

vi.mock('../lib/push', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/push')>();
  return {
    ...actual,
    pushSupport: vi.fn(),
    currentSubscription: vi.fn(),
    turnOn: vi.fn(),
    turnOff: vi.fn(),
  };
});

const mocked = vi.mocked(push);

beforeEach(() => {
  vi.stubGlobal('Notification', { permission: 'default' });
  mocked.pushSupport.mockReturnValue('supported');
  mocked.currentSubscription.mockResolvedValue(null);
  mocked.turnOn.mockResolvedValue('on');
  mocked.turnOff.mockResolvedValue(undefined);
  server.use(http.get(`${API_URL}/push/config`, () => HttpResponse.json({ publicKey: 'PUBLIC-KEY' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderSettings = () => renderSignedIn('/settings', <SettingsPage />);

describe('turning on push reminders', () => {
  it('asks for permission only after "Turn on reminders" is tapped', async () => {
    const user = userEvent.setup();
    renderSettings();
    const button = await screen.findByRole('button', { name: 'Turn on reminders' });
    expect(mocked.turnOn).not.toHaveBeenCalled();
    await user.click(button);
    expect(mocked.turnOn).toHaveBeenCalledWith('PUBLIC-KEY');
    expect(await screen.findByText('Reminders are on for this device.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off on this device' })).toBeInTheDocument();
  });

  it('explains how to unblock notifications when permission is denied', async () => {
    const user = userEvent.setup();
    mocked.turnOn.mockResolvedValue('blocked');
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }));
    expect(await screen.findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
  });

  it('says nothing changed if the permission prompt is dismissed', async () => {
    const user = userEvent.setup();
    mocked.turnOn.mockResolvedValue('dismissed');
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }));
    expect(await screen.findByText(/Reminders weren’t turned on/)).toBeInTheDocument();
  });

  it('can be turned off on this device', async () => {
    const user = userEvent.setup();
    mocked.currentSubscription.mockResolvedValue({} as PushSubscription);
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Turn off on this device' }));
    expect(mocked.turnOff).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Turn on reminders' })).toBeInTheDocument();
  });
});

describe('when push isn’t available', () => {
  it('on iPhone, says the app must be added to the Home Screen first', async () => {
    mocked.pushSupport.mockReturnValue('ios-needs-home-screen');
    renderSettings();
    expect(await screen.findByText(/On iPhone, reminders need the app on your Home Screen first/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders' })).not.toBeInTheDocument();
  });

  it('in a browser without push, points to the in-app reminders', async () => {
    mocked.pushSupport.mockReturnValue('unsupported');
    renderSettings();
    expect(await screen.findByText(/This browser can’t show push reminders/)).toBeInTheDocument();
  });

  it('when the server has no VAPID key, says push isn’t set up', async () => {
    server.use(http.get(`${API_URL}/push/config`, () => HttpResponse.json({ publicKey: null })));
    renderSettings();
    expect(await screen.findByText(/Push reminders aren’t set up on this server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders' })).not.toBeInTheDocument();
  });

  it('always notes that reminders still appear in the app', async () => {
    mocked.pushSupport.mockReturnValue('unsupported');
    renderSettings();
    expect(
      await screen.findByText('Every reminder also appears under the bell, even if a push doesn’t arrive.'),
    ).toBeInTheDocument();
  });
});

describe('daily summary or one per item', () => {
  it('saves the mode and the hour', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    let saved: Record<string, unknown> = { mode: 'DIGEST', hour: 8 };
    server.use(
      http.put(`${API_URL}/notifications/delivery`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        saved = { ...saved, ...body };
        return HttpResponse.json(saved);
      }),
    );
    renderSettings();
    expect(await screen.findByRole('button', { name: /One daily summary/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /One per item/ }));
    await waitFor(() => expect(bodies).toEqual([{ mode: 'EACH_ITEM' }]));
    expect(screen.getByRole('button', { name: /One per item/ })).toHaveAttribute('aria-pressed', 'true');

    await user.selectOptions(screen.getByLabelText('Time'), '18');
    await waitFor(() => expect(bodies).toEqual([{ mode: 'EACH_ITEM' }, { hour: 18 }]));
    expect(screen.getByLabelText('Time')).toHaveValue('18');
    expect(useAuthStore.getState().user?.reminderDelivery).toEqual({ mode: 'EACH_ITEM', hour: 18 });
  });
});

describe('logging out', () => {
  it('turns off push on this device using the token from before sign-out', async () => {
    renderSettings();
    useAuthStore.getState().logout();
    expect(mocked.turnOff).toHaveBeenCalledWith('test-token');
    expect(useAuthStore.getState().token).toBeNull();
  });
});
