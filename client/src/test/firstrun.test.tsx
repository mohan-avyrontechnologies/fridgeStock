import type { User } from '@cook-first/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { App } from '../App';
import { server } from '../mocks/server';
import { platform } from '../platform';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';

/** The first-run guide: shown once to a new account, three steps, and the only place (besides Settings) permission is asked. */

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  timeZone: 'UTC',
  currency: 'USD',
  savePhotos: true,
  notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
  reminderDelivery: { mode: 'DIGEST', hour: 8 },
  ...over,
});

/** Opens the app signed in as a new account. Pass null to keep whoever is already signed in. */
function open(path = '/', person: User | null = user({ firstRunDone: false })) {
  if (person) useAuthStore.setState({ token: 't', user: person });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Records PUT /auth/me bodies and answers with the user marked done. */
function me(fail = false) {
  const bodies: unknown[] = [];
  server.use(
    http.put(`${API_URL}/auth/me`, async ({ request }) => {
      bodies.push(await request.json());
      if (fail) return HttpResponse.json({ error: { code: 'SERVER', message: 'no' } }, { status: 500 });
      return HttpResponse.json({ user: user({ firstRunDone: true }) });
    }),
  );
  return bodies;
}

beforeEach(() => useFoodStore.getState().reset());
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ token: null, user: null });
});

describe('who sees the guide', () => {
  it('a new account sees it first, whatever page it asked for', async () => {
    open('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Cook First' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Hi, / })).not.toBeInTheDocument();
  });

  it('is shown instead of any other page, such as Shopping', async () => {
    open('/shopping');
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Cook First' })).toBeInTheDocument();
  });

  it('an account that has finished it, or that predates it, goes straight to Home', async () => {
    open('/', user({ firstRunDone: true }));
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to Cook First' })).not.toBeInTheDocument();
  });

  it('an account from before the guide existed has no value, which counts as done', async () => {
    open('/', user());
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
  });

  it('can be opened again from Settings', async () => {
    const reader = userEvent.setup();
    open('/settings', user({ firstRunDone: true }));
    await reader.click(await screen.findByRole('link', { name: 'How Cook First works' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Cook First' })).toBeInTheDocument();
  });
});

describe('step 1: what "expected expiry" means', () => {
  it('explains it, and shows the disclaimer in a note', async () => {
    open();
    expect(await screen.findByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What “expected expiry” means' })).toBeInTheDocument();
    const note = screen.getByRole('note', { name: 'Please remember' });
    expect(
      within(note).getByText(
        'Expected expiry is an estimate to help you plan. Always check your food before eating it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('does not ask for any permission', async () => {
    const ask = vi.fn(async () => 'granted');
    vi.stubGlobal(
      'Notification',
      Object.assign(function () {}, { requestPermission: ask, permission: 'default' }),
    );
    open();
    await screen.findByText('Step 1 of 3');
    expect(ask).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('moving through the steps', () => {
  it('Next and Back move between the three steps, with the step announced and focus on its heading', async () => {
    const reader = userEvent.setup();
    open();
    await reader.click(await screen.findByRole('button', { name: /Next/ }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    const second = screen.getByRole('heading', { level: 1, name: 'Add your first food' });
    expect(second).toHaveFocus();
    await reader.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Meal times and reminders' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();
    await reader.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });
});

describe('step 2: the first food', () => {
  async function toStepTwo() {
    const reader = userEvent.setup();
    open();
    await reader.click(await screen.findByRole('button', { name: /Next/ }));
    return reader;
  }

  it('offers the camera first, then common foods', async () => {
    await toStepTwo();
    expect(screen.getByRole('button', { name: 'Use the camera' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Or pick a few common foods' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Milk', 'Eggs', 'Bread', 'Chicken', 'Spinach', 'Yoghurt', 'Carrots']);
  });

  it('adds the chosen foods to the fridge in one request, each with its usual unit and lifespan', async () => {
    const sent: {
      addedDate: string;
      storage: string;
      items: { name: string; quantity: number; unit: string; lifespanDays: number }[];
    }[] = [];
    server.use(
      http.post(`${API_URL}/foods/bulk`, async ({ request }) => {
        sent.push((await request.json()) as never);
        return HttpResponse.json({ items: [] }, { status: 201 });
      }),
    );
    const reader = await toStepTwo();
    await reader.click(screen.getByRole('button', { name: 'Milk' }));
    await reader.click(screen.getByRole('button', { name: 'Eggs' }));
    await reader.click(screen.getByRole('button', { name: 'Add 2 foods' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.storage).toBe('FRIDGE');
    expect(sent[0]!.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent[0]!.items).toEqual([
      { name: 'Milk', quantity: 1, unit: 'l', lifespanDays: 5, storage: 'FRIDGE' },
      { name: 'Eggs', quantity: 1, unit: 'pcs', lifespanDays: 21, storage: 'FRIDGE' },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('Added: Milk, Eggs');
    // They leave the list of things to pick.
    expect(screen.queryByRole('button', { name: 'Milk' })).not.toBeInTheDocument();
  });

  it('says what went wrong, and what to do, when adding fails', async () => {
    server.use(
      http.post(`${API_URL}/foods/bulk`, () =>
        HttpResponse.json({ error: { code: 'SERVER', message: 'no' } }, { status: 500 }),
      ),
    );
    const reader = await toStepTwo();
    await reader.click(screen.getByRole('button', { name: 'Bread' }));
    await reader.click(screen.getByRole('button', { name: 'Add 1 food' }));
    expect(await screen.findByText('Couldn’t add that. Check your connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bread' })).toBeInTheDocument();
  });

  it('shows favourites first when there are any, and re-adds one in a tap', async () => {
    const added: string[] = [];
    server.use(
      http.get(`${API_URL}/favourites`, () =>
        HttpResponse.json({
          items: [{ id: 'f1', name: 'Oat milk', quantity: 1, unit: 'l', lifespanDays: 7, storage: 'FRIDGE' }],
        }),
      ),
      http.post(`${API_URL}/favourites/:id/add`, ({ params }) => {
        added.push(String(params.id));
        return HttpResponse.json({ id: 'x', name: 'Oat milk' }, { status: 201 });
      }),
    );
    const reader = await toStepTwo();
    await reader.click(await screen.findByRole('button', { name: 'Add Oat milk again' }));
    await waitFor(() => expect(added).toEqual(['f1']));
    expect(await screen.findByRole('status')).toHaveTextContent('Added: Oat milk');
  });
});

describe('step 3: meal times and reminders', () => {
  async function toStepThree() {
    const reader = userEvent.setup();
    open();
    await reader.click(await screen.findByRole('button', { name: /Next/ }));
    await reader.click(screen.getByRole('button', { name: /Next/ }));
    return reader;
  }

  it('lets you choose meal times, saved as you go', async () => {
    const sent: unknown[] = [];
    server.use(
      http.put(`${API_URL}/notifications/meals`, async ({ request }) => {
        const body = await request.json();
        sent.push(body);
        return HttpResponse.json({
          breakfast: { enabled: false, time: '07:30' },
          lunch: { enabled: false, time: '12:30' },
          dinner: { enabled: true, time: '19:30' },
        });
      }),
    );
    const reader = await toStepThree();
    await reader.click(await screen.findByRole('switch', { name: 'Dinner' }));
    await waitFor(() => expect(sent).toEqual([{ dinner: { enabled: true } }]));
    expect(await screen.findByLabelText('Dinner reminder time')).toHaveValue('19:30');
  });

  it('asks for the phone’s permission only when "Turn on reminders" is tapped', async () => {
    server.use(http.get(`${API_URL}/push/config`, () => HttpResponse.json({ publicKey: 'KEY', native: false })));
    vi.spyOn(platform.push, 'support').mockReturnValue('supported');
    vi.spyOn(platform.push, 'isAvailable').mockReturnValue(true);
    vi.spyOn(platform.push, 'isBlocked').mockReturnValue(false);
    vi.spyOn(platform.push, 'isOn').mockResolvedValue(false);
    const turnOn = vi.spyOn(platform.push, 'turnOn').mockResolvedValue('on');
    const reader = await toStepThree();
    const button = await screen.findByRole('button', { name: 'Turn on reminders' });
    expect(turnOn).not.toHaveBeenCalled();
    await reader.click(button);
    await waitFor(() => expect(turnOn).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Reminders are on for this device.')).toBeInTheDocument();
  });

  it('explains why reminders cannot be turned on here, instead of offering a button', async () => {
    vi.spyOn(platform.push, 'support').mockReturnValue('unsupported');
    await toStepThree();
    expect(await screen.findByText(/can’t show push reminders/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders' })).not.toBeInTheDocument();
  });
});

describe('leaving the guide', () => {
  it('Skip for now marks it done and opens Home', async () => {
    const reader = userEvent.setup();
    const bodies = me();
    open();
    await reader.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
    expect(bodies).toEqual([{ firstRunDone: true }]);
    expect(useAuthStore.getState().user?.firstRunDone).toBe(true);
  });

  it('Start using Cook First (the last step) does the same', async () => {
    const reader = userEvent.setup();
    const bodies = me();
    open();
    await reader.click(await screen.findByRole('button', { name: /Next/ }));
    await reader.click(screen.getByRole('button', { name: /Next/ }));
    await reader.click(screen.getByRole('button', { name: 'Start using Cook First' }));
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
    expect(bodies).toEqual([{ firstRunDone: true }]);
  });

  it('is not shown again once done', async () => {
    const reader = userEvent.setup();
    me();
    const view = open();
    await reader.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Hi, Asha Rao' });
    view.unmount();
    open('/', null);
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
  });

  it('never traps anyone in it: if saving fails, it still leaves, and says so', async () => {
    const reader = userEvent.setup();
    me(true);
    open();
    await reader.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
    expect(await screen.findByText(/Couldn’t save that you’ve seen the guide/)).toBeInTheDocument();
  });
});
