import type { MealPlan, User } from '@fridgestock/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { hasInteracted, playChime, resetChime, shouldChime, soundUrl, trackInteraction } from '../lib/chime';
import { REMINDER_MESSAGE, useReminderChime } from '../lib/useReminderChime';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { MealReminderPage } from '../pages/MealReminderPage';
import { PlanPage } from '../pages/PlanPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PUSH_RECEIVED_EVENT } from '../platform/events';
import { useAiStore } from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

/** Reminder sounds, quiet hours, the meal-time settings and the screens that go with them. The API is faked with MSW. */

const baseUser: User = {
  id: 'u1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  timeZone: 'UTC',
  currency: 'USD',
  savePhotos: true,
  notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
  reminderDelivery: { mode: 'DIGEST', hour: 8 },
};

/** Plays are recorded here instead of making a sound. */
const played: string[] = [];
function fakeAudio(play: () => Promise<void> = async () => {}) {
  vi.stubGlobal(
    'Audio',
    class {
      constructor(public url: string) {}
      play() {
        played.push(this.url);
        return play();
      }
    },
  );
}

/** Pins the clock to a UTC instant (only Date, so timers and promises keep working). */
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};

beforeEach(() => {
  played.length = 0;
  resetChime();
  fakeAudio();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ token: null, user: null });
});

const touch = () => window.dispatchEvent(new Event('pointerdown'));

describe('the in-app chime files', () => {
  it('has a gentle, a strong and a meal sound, each a different file', () => {
    const urls = (['gentle', 'strong', 'meal'] as const).map((name) => soundUrl(name));
    for (const [i, name] of ['gentle', 'strong', 'meal'].entries()) expect(urls[i], name).toContain(name);
    expect(new Set(urls).size).toBe(3);
  });
});

describe('when the chime may play', () => {
  const user: User = { ...baseUser };

  it('not until the person has touched the page', async () => {
    at('2026-10-03T12:00:00Z');
    trackInteraction();
    expect(hasInteracted()).toBe(false);
    expect(await playChime(user, 'DUE')).toBe(false);
    expect(played).toEqual([]);
    touch();
    expect(hasInteracted()).toBe(true);
    expect(await playChime(user, 'DUE')).toBe(true);
    expect(played).toHaveLength(1);
  });

  it('any of a click, a key press or a touch counts', () => {
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      resetChime();
      trackInteraction();
      window.dispatchEvent(new Event(type));
      expect(hasInteracted(), type).toBe(true);
    }
  });

  it('plays the matching sound: gentle, strong or meal', async () => {
    at('2026-10-03T12:00:00Z');
    trackInteraction();
    touch();
    const expected = {
      APPROACHING_EXPIRY: 'gentle',
      DIGEST: 'gentle',
      DUE: 'strong',
      OVERDUE: 'strong',
      MEAL: 'meal',
    } as const;
    for (const [kind, sound] of Object.entries(expected)) {
      played.length = 0;
      await playChime(user, kind as keyof typeof expected);
      expect(played, kind).toEqual([soundUrl(sound)]);
    }
  });

  it('never during quiet hours (22:00 to 07:00), and in the person’s own time zone', async () => {
    trackInteraction();
    touch();
    at('2026-10-03T23:00:00Z');
    expect(await playChime(user, 'DUE')).toBe(false);
    at('2026-10-04T06:59:00Z');
    expect(await playChime(user, 'MEAL')).toBe(false);
    at('2026-10-04T07:00:00Z');
    expect(await playChime(user, 'MEAL')).toBe(true);

    played.length = 0;
    const kolkata = { ...user, timeZone: 'Asia/Kolkata' };
    at('2026-10-03T17:30:00Z'); // 23:00 in Kolkata, 17:30 in UTC
    expect(await playChime(kolkata, 'DUE')).toBe(false);
    expect(await playChime(user, 'DUE')).toBe(true);
  });

  it('not when sounds are switched off, and quiet hours can be switched off', async () => {
    trackInteraction();
    touch();
    at('2026-10-03T12:00:00Z');
    const off: User = {
      ...user,
      alerts: { sound: false, vibration: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } },
    };
    expect(shouldChime(off, new Date())).toBe(false);
    expect(await playChime(off, 'DUE')).toBe(false);

    at('2026-10-03T23:00:00Z');
    const noQuiet: User = {
      ...user,
      alerts: { sound: true, vibration: true, quietHours: { enabled: false, start: '22:00', end: '07:00' } },
    };
    expect(await playChime(noQuiet, 'DUE')).toBe(true);
  });

  it('not when nobody is signed in', async () => {
    trackInteraction();
    touch();
    expect(await playChime(null, 'DUE')).toBe(false);
  });

  it('says false, rather than failing, when the browser refuses to play', async () => {
    fakeAudio(async () => {
      throw new Error('NotAllowedError');
    });
    at('2026-10-03T12:00:00Z');
    trackInteraction();
    touch();
    expect(await playChime(baseUser, 'DUE')).toBe(false);
  });
});

describe('reminders arriving while the app is open', () => {
  function Harness() {
    useReminderChime();
    return null;
  }
  let worker: EventTarget;
  beforeEach(() => {
    worker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true });
    at('2026-10-03T12:00:00Z');
    useAuthStore.setState({ token: 't', user: baseUser });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
  const push = (kind: unknown) =>
    window.dispatchEvent(new CustomEvent(PUSH_RECEIVED_EVENT, { detail: kind === undefined ? undefined : { kind } }));

  it('plays the chime for a push the app receives (the apps), after a touch', async () => {
    render(<Harness />);
    push('DUE');
    await act(async () => {});
    expect(played).toEqual([]); // not touched yet
    touch();
    push('DUE');
    await waitFor(() => expect(played).toEqual([soundUrl('strong')]));
  });

  it('plays the chime for a push the service worker reports (browsers)', async () => {
    render(<Harness />);
    touch();
    worker.dispatchEvent(new MessageEvent('message', { data: { type: REMINDER_MESSAGE, kind: 'MEAL' } }));
    await waitFor(() => expect(played).toEqual([soundUrl('meal')]));
  });

  it('ignores a push of an unknown or missing kind, and other messages', async () => {
    render(<Harness />);
    touch();
    push('SHOUT');
    push(undefined);
    push(null);
    worker.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else', kind: 'DUE' } }));
    await act(async () => {});
    expect(played).toEqual([]);
  });

  it('stops listening when the app closes', async () => {
    const view = render(<Harness />);
    touch();
    view.unmount();
    push('DUE');
    worker.dispatchEvent(new MessageEvent('message', { data: { type: REMINDER_MESSAGE, kind: 'DUE' } }));
    await act(async () => {});
    expect(played).toEqual([]);
  });
});

describe('Settings: sounds and quiet hours', () => {
  /** A PUT that remembers what it was sent and answers with the result. */
  function serverAlerts(
    initial = { sound: true, vibration: true, quietHours: { enabled: true, start: '22:00', end: '07:00' } },
  ) {
    let alerts = initial;
    const sent: unknown[] = [];
    server.use(
      http.get(`${API_URL}/notifications/alerts`, () => HttpResponse.json(alerts)),
      http.put(`${API_URL}/notifications/alerts`, async ({ request }) => {
        const body = (await request.json()) as { sound?: boolean; vibration?: boolean; quietHours?: object };
        sent.push(body);
        alerts = { ...alerts, ...body, quietHours: { ...alerts.quietHours, ...body.quietHours } };
        return HttpResponse.json(alerts);
      }),
    );
    return sent;
  }
  const renderSettings = () => renderSignedIn('/settings', <SettingsPage />);

  it('shows the defaults: sounds, vibration and quiet hours on, 22:00 to 07:00, in the person’s time zone', async () => {
    renderSettings();
    expect(await screen.findByRole('switch', { name: /Reminder sounds/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Vibration/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Quiet hours/ })).toBeChecked();
    expect(screen.getByLabelText('From')).toHaveValue('22:00');
    expect(screen.getByLabelText('To')).toHaveValue('07:00');
    expect(screen.getByText('In your time zone (UTC).')).toBeInTheDocument();
  });

  it('saves each switch as it is changed, and keeps the person’s settings up to date', async () => {
    const user = userEvent.setup();
    const sent = serverAlerts();
    renderSettings();
    await user.click(await screen.findByRole('switch', { name: /Reminder sounds/ }));
    await user.click(screen.getByRole('switch', { name: /Vibration/ }));
    await waitFor(() => expect(sent).toEqual([{ sound: false }, { vibration: false }]));
    expect(screen.getByRole('switch', { name: /Reminder sounds/ })).not.toBeChecked();
    await waitFor(() => expect(useAuthStore.getState().user?.alerts).toMatchObject({ sound: false, vibration: false }));
  });

  it('turns quiet hours off, hiding the times, and on again', async () => {
    const user = userEvent.setup();
    const sent = serverAlerts();
    renderSettings();
    await user.click(await screen.findByRole('switch', { name: /Quiet hours/ }));
    await waitFor(() => expect(screen.queryByLabelText('From')).not.toBeInTheDocument());
    await user.click(screen.getByRole('switch', { name: /Quiet hours/ }));
    expect(await screen.findByLabelText('From')).toBeInTheDocument();
    expect(sent).toEqual([{ quietHours: { enabled: false } }, { quietHours: { enabled: true } }]);
  });

  it('changes the start and end of quiet hours', async () => {
    const sent = serverAlerts();
    renderSettings();
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '23:15' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06:30' } });
    await waitFor(() => expect(sent).toEqual([{ quietHours: { start: '23:15' } }, { quietHours: { end: '06:30' } }]));
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('23:15'));
  });

  it('puts the setting back and says so when saving fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_URL}/notifications/alerts`, () =>
        HttpResponse.json({
          sound: true,
          vibration: true,
          quietHours: { enabled: true, start: '22:00', end: '07:00' },
        }),
      ),
      http.put(`${API_URL}/notifications/alerts`, () =>
        HttpResponse.json({ error: { code: 'X', message: 'no' } }, { status: 500 }),
      ),
    );
    renderSettings();
    await user.click(await screen.findByRole('switch', { name: /Reminder sounds/ }));
    expect(await screen.findByText('Couldn’t save that. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Reminder sounds/ })).toBeChecked();
  });
});

describe('Settings: meal reminders', () => {
  function serverMeals() {
    let meals = {
      breakfast: { enabled: false, time: '07:30' },
      lunch: { enabled: false, time: '12:30' },
      dinner: { enabled: false, time: '19:30' },
    };
    const sent: unknown[] = [];
    server.use(
      http.get(`${API_URL}/notifications/meals`, () => HttpResponse.json(meals)),
      http.put(`${API_URL}/notifications/meals`, async ({ request }) => {
        const body = (await request.json()) as Record<string, object>;
        sent.push(body);
        for (const [meal, change] of Object.entries(body)) {
          meals = { ...meals, [meal]: { ...meals[meal as keyof typeof meals], ...change } };
        }
        return HttpResponse.json(meals);
      }),
    );
    return sent;
  }

  it('lists breakfast, lunch and dinner, all off, with no times until one is turned on', async () => {
    renderSignedIn('/settings', <SettingsPage />);
    const list = (await screen.findByRole('heading', { name: 'Meal reminders' })).closest('section')!;
    for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
      expect(within(list).getByRole('switch', { name: meal })).not.toBeChecked();
    }
    expect(within(list).queryByLabelText(/reminder time/)).not.toBeInTheDocument();
  });

  it('turns a meal on, showing its default time, and changes the time', async () => {
    const user = userEvent.setup();
    const sent = serverMeals();
    renderSignedIn('/settings', <SettingsPage />);
    await user.click(await screen.findByRole('switch', { name: 'Lunch' }));
    const time = await screen.findByLabelText('Lunch reminder time');
    expect(time).toHaveValue('12:30');
    fireEvent.change(time, { target: { value: '13:00' } });
    await waitFor(() => expect(sent).toEqual([{ lunch: { enabled: true } }, { lunch: { time: '13:00' } }]));
    expect(screen.queryByLabelText('Dinner reminder time')).not.toBeInTheDocument();
    expect(useAuthStore.getState().user?.mealReminders?.lunch).toEqual({ enabled: true, time: '13:00' });
  });

  it('shows the default times of 07:30 and 19:30 for breakfast and dinner', async () => {
    const user = userEvent.setup();
    serverMeals();
    renderSignedIn('/settings', <SettingsPage />);
    await user.click(await screen.findByRole('switch', { name: 'Breakfast' }));
    await user.click(screen.getByRole('switch', { name: 'Dinner' }));
    expect(await screen.findByLabelText('Breakfast reminder time')).toHaveValue('07:30');
    expect(screen.getByLabelText('Dinner reminder time')).toHaveValue('19:30');
  });
});

describe('the meal reminder screen ("Show recipe")', () => {
  function Where() {
    const location = useLocation();
    return <p data-testid="where">{location.pathname + location.search}</p>;
  }
  function renderAt(path: string) {
    useAuthStore.setState({ token: 't', user: baseUser });
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/meal/:meal" element={<MealReminderPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const reminder = (content: unknown, meal = 'breakfast') =>
    server.use(
      http.get(`${API_URL}/meal-reminders/${meal}`, () => HttpResponse.json({ meal, date: '2026-10-03', content })),
    );

  it('shows a recipe with what it uses and its steps', async () => {
    reminder({
      source: 'recipe',
      recipe: {
        title: 'Cheesy toast',
        minutes: 15,
        steps: ['Slice the bread.', 'Grill it.'],
        uses: [{ id: 'f1', name: 'Bread' }],
      },
    });
    renderAt('/meal/breakfast');
    expect(await screen.findByRole('heading', { name: 'Cheesy toast' })).toBeInTheDocument();
    expect(screen.getByText('About 15 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bread' })).toHaveAttribute('href', '/food/f1');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Slice the bread.', 'Grill it.']);
    expect(screen.getByText(/AI suggestion/)).toBeInTheDocument();
  });

  it('shows the planned meal', async () => {
    reminder({ source: 'plan', title: 'Porridge', foods: [{ id: 'f2', name: 'Oats' }] });
    renderAt('/meal/breakfast');
    expect(await screen.findByRole('heading', { name: 'Porridge' })).toBeInTheDocument();
    expect(screen.getByText('Planned for this meal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Oats' })).toBeInTheDocument();
  });

  it('with no recipe, lists the items to use up with their days left in expected-expiry words', async () => {
    reminder({
      source: 'items',
      items: [
        { id: 'a', name: 'Bread', remainingDays: 0 },
        { id: 'b', name: 'Chicken', remainingDays: 2 },
        { id: 'c', name: 'Ham', remainingDays: -1 },
      ],
    });
    renderAt('/meal/lunch'.replace('lunch', 'breakfast'));
    expect(await screen.findByText('No recipe this time')).toBeInTheDocument();
    expect(screen.getByText(/expected expiry today/)).toBeInTheDocument();
    expect(screen.getByText(/expected expiry in 2 days/)).toBeInTheDocument();
    expect(screen.getByText(/past its expected expiry/)).toBeInTheDocument();
  });

  it('"Cooked it" opens the leftovers form for the recipe, and for an items-only reminder without a name', async () => {
    const user = userEvent.setup();
    reminder({ source: 'recipe', recipe: { title: 'Cheesy toast', minutes: 5, steps: ['Go.'], uses: [] } });
    renderAt('/meal/breakfast');
    await user.click(await screen.findByRole('button', { name: 'Cooked it' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/add?leftover=1&from=Cheesy%20toast');
  });

  it('"Cooked it" for a plain reminder has no name to start from', async () => {
    const user = userEvent.setup();
    reminder({ source: 'items', items: [{ id: 'a', name: 'Bread', remainingDays: 0 }] });
    renderAt('/meal/breakfast');
    await user.click(await screen.findByRole('button', { name: 'Cooked it' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/add?leftover=1');
    expect(screen.getByTestId('where').textContent).not.toContain('from=');
  });

  it('says so when there was no reminder for that meal today', async () => {
    server.use(
      http.get(`${API_URL}/meal-reminders/dinner`, () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'none' } }, { status: 404 }),
      ),
    );
    renderAt('/meal/dinner');
    expect(await screen.findByText('There’s no reminder for this meal today.')).toBeInTheDocument();
  });

  it('goes Home for a meal that is not breakfast, lunch or dinner', async () => {
    renderAt('/meal/supper');
    expect(await screen.findByTestId('where')).toHaveTextContent('/');
  });
});

describe('Add Food from a meal reminder', () => {
  it('"Cooked it" opens the form with leftovers ticked and a name from the meal', async () => {
    renderSignedIn('/add?leftover=1&from=Chicken%20curry', <AddFoodPage />, '/add');
    expect(await screen.findByLabelText(/These are leftovers/)).toBeChecked();
    expect(screen.getByLabelText('Food')).toHaveValue('Leftover Chicken curry');
  });

  it('without a name, only the leftovers box is ticked', async () => {
    renderSignedIn('/add?leftover=1', <AddFoodPage />, '/add');
    expect(await screen.findByLabelText(/These are leftovers/)).toBeChecked();
    expect(screen.getByLabelText('Food')).toHaveValue('');
  });

  it('an ordinary visit is unchanged', async () => {
    renderSignedIn('/add', <AddFoodPage />, '/add');
    expect(await screen.findByLabelText(/These are leftovers/)).not.toBeChecked();
  });
});

describe('the meal plan, one meal at a time', () => {
  const entry = (meal: string, title: string) => ({ meal, title, foods: [] });
  const plan = (): MealPlan => ({
    today: '2026-10-03',
    days: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(
      (date, i) => ({
        date,
        entry: i === 0 ? (entry('dinner', 'Stew') as never) : null,
        meals: i === 0 ? { dinner: entry('dinner', 'Stew'), breakfast: entry('breakfast', 'Porridge') } : {},
      }),
    ) as never,
  });

  beforeEach(() => {
    useAiStore.setState({ status: null });
    server.use(
      http.get(`${API_URL}/ai/status`, () =>
        HttpResponse.json({ enabled: true, photoCheck: false, dailyLimit: 20, usedToday: 0 }),
      ),
    );
  });

  it('shows dinner first, and switches to breakfast or lunch', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_URL}/meal-plan`, () => HttpResponse.json(plan())));
    renderSignedIn('/plan', <PlanPage />);
    expect(await screen.findByText('Stew')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Breakfast, lunch or dinner' });
    expect(within(group).getByRole('button', { name: 'Dinner' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group).getByRole('button', { name: 'Breakfast' }));
    expect(screen.getByText('Porridge')).toBeInTheDocument();
    expect(screen.queryByText('Stew')).not.toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Lunch' }));
    expect(screen.queryByText('Porridge')).not.toBeInTheDocument();
    expect(screen.getAllByText('Nothing planned')).toHaveLength(7);
  });

  it('plans and clears a breakfast, naming the meal in the request', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let saved: unknown;
    server.use(
      http.get(`${API_URL}/meal-plan`, () => HttpResponse.json(plan())),
      http.put(`${API_URL}/meal-plan/:date`, async ({ request, params }) => {
        saved = { date: params.date, body: await request.json() };
        return HttpResponse.json(entry('breakfast', 'Eggs'));
      }),
      http.delete(`${API_URL}/meal-plan/:date`, ({ request }) => {
        calls.push(new URL(request.url).search);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSignedIn('/plan', <PlanPage />);
    await user.click(await screen.findByRole('button', { name: 'Breakfast' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(calls).toEqual(['?meal=breakfast']));

    await user.click(screen.getAllByRole('button', { name: 'Plan a meal' })[0]!);
    await user.type(screen.getByLabelText('Meal'), 'Eggs');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toEqual({ date: '2026-10-04', body: { meal: 'breakfast', title: 'Eggs', foodIds: [] } }),
    );
  });

  it('offers AI suggestions for dinner only', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_URL}/meal-plan`, () => HttpResponse.json(plan())));
    renderSignedIn('/plan', <PlanPage />);
    expect(await screen.findByRole('button', { name: 'Suggest meals for empty days' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Breakfast' }));
    expect(screen.queryByRole('button', { name: 'Suggest meals for empty days' })).not.toBeInTheDocument();
  });
});
