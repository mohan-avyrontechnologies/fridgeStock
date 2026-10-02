import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { remainingText, urgencyCopy } from '../copy';
import { URGENCY_STYLE } from '../components/Urgency';
import { AddFoodPage } from '../pages/AddFoodPage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { CookFirstPage } from '../pages/CookFirstPage';
import { DashboardPage } from '../pages/DashboardPage';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';
import { API_URL } from '../api/client';
import { item, sampleItems } from '../mocks/handlers';
import { server } from '../mocks/server';

describe('Dashboard', () => {
  it('shows every item in server order with its urgency label and counts', async () => {
    renderSignedIn('/', <DashboardPage />);
    const list = await screen.findByRole('region', { name: 'All food (4)' });
    const names = within(list)
      .getAllByRole('listitem')
      .map((li) => within(li).getByRole('heading', { level: 3 }).textContent);
    expect(names).toEqual(['Bread', 'Yoghurt', 'Spinach', 'Eggs']);

    expect(within(list).getByText('Past expected expiry')).toBeInTheDocument();
    expect(within(list).getByText('Expected expiry today', { selector: 'span' })).toBeInTheDocument();
    expect(within(list).getByText('Use soon')).toBeInTheDocument();
    expect(within(list).getByText('Not urgent')).toBeInTheDocument();
    expect(within(list).getByText('1 day past expected expiry')).toBeInTheDocument();
    expect(within(list).getByText('2 days left')).toBeInTheDocument();
  });

  it('never uses the word "safe" in anything it renders', async () => {
    const { container } = renderSignedIn('/', <DashboardPage />);
    await screen.findByRole('heading', { name: 'All food (4)' });
    expect(container.textContent).not.toMatch(/\bsafe\b/i);
  });

  it('shows an empty state for a new user', async () => {
    server.use(
      http.get(`${API_URL}/foods`, () =>
        HttpResponse.json({
          today: '2026-09-29',
          summary: { NOT_URGENT: 0, APPROACHING_EXPIRY: 0, DUE: 0, OVERDUE: 0, total: 0 },
          items: [],
        }),
      ),
      http.get(`${API_URL}/foods/cook-first`, () => HttpResponse.json({ today: '2026-09-29', items: [] })),
    );
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByText('Your fridge is empty. Add your first item.')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs cooking first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan a meal' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add food' }).length).toBeGreaterThan(0);
  });

  it('signs out when the token is rejected', async () => {
    server.use(
      http.get(`${API_URL}/foods`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, { status: 401 }),
      ),
    );
    renderSignedIn('/', <DashboardPage />);
    await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
  });
});

describe('Cook First', () => {
  it('lists only items that are not "Not urgent"', async () => {
    renderSignedIn('/cook-first', <CookFirstPage />);
    await screen.findByText('3 items are at or near expected expiry', { exact: false });
    expect(screen.queryByText('Eggs')).not.toBeInTheDocument();
    for (const name of ['Bread', 'Yoghurt', 'Spinach']) expect(screen.getByText(name)).toBeInTheDocument();
  });

  it('records partial use with an amount', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(`${API_URL}/foods/c/use`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ food: item({ id: 'c', quantity: 0.5 }), usageRecord: {} });
      }),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Mark as used: Spinach' }));
    const dialog = screen.getByRole('dialog', { name: 'Spinach' });
    await user.click(within(dialog).getByRole('button', { name: /Mark some as used/ }));
    await user.type(within(dialog).getByLabelText(/How much did you use/), '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Mark some as used' }));
    await waitFor(() => expect(body).toEqual({ quantity: 0.5 }));
  });
});

describe('Add food', () => {
  it('validates required fields before calling the API', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    expect(screen.getByText('Food name is required.')).toBeInTheDocument();
    expect(screen.getByText('Lifespan must be a whole number of days from 0 to 365.')).toBeInTheDocument();
  });

  it('previews expected expiry and sends the five fields', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sampleItems[2], { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Spinach');
    await user.selectOptions(screen.getByLabelText('Unit'), 'bunch');
    await user.click(screen.getByRole('button', { name: '2 days' }));
    expect(screen.getByText(/2 days left/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Spinach', quantity: 1, unit: 'bunch', lifespanDays: 2 });
    expect(body!.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows the server validation message on the right field', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/foods`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Food name must be at most 100 characters.', field: 'name' } },
          { status: 400 },
        ),
      ),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'x');
    await user.click(screen.getByRole('button', { name: '3 days' }));
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    expect(await screen.findByText('Food name must be at most 100 characters.')).toBeInTheDocument();
  });
});

const REQUIRED_LINE = 'Expected expiry is an estimate to help you plan. Always check your food before eating it.';

describe('required estimate line', () => {
  it('is shown on Add Food', () => {
    renderSignedIn('/add', <AddFoodPage />);
    expect(screen.getByText(REQUIRED_LINE)).toBeInTheDocument();
  });

  it('is shown on Cook First, with or without items', async () => {
    renderSignedIn('/cook-first', <CookFirstPage />);
    await screen.findByText('3 items are at or near expected expiry', { exact: false });
    expect(screen.getByText(REQUIRED_LINE)).toBeInTheDocument();
  });
});

describe('copy', () => {
  it('uses the agreed urgency labels', () => {
    expect(Object.values(urgencyCopy).map((c) => c.label)).toEqual([
      'Not urgent',
      'Use soon',
      'Expected expiry today',
      'Past expected expiry',
    ]);
  });
});

describe('remaining-days text', () => {
  it.each([
    [5, '5 days left'],
    [2, '2 days left'],
    [1, '1 day left'],
    [0, 'Expected expiry today'],
    [-1, '1 day past expected expiry'],
    [-4, '4 days past expected expiry'],
  ])('%i → "%s"', (days, text) => {
    expect(remainingText(days)).toBe(text);
  });
});

describe('urgency is never shown by colour alone', () => {
  it('every urgency state has both a colour and a text label', () => {
    for (const urgency of ['NOT_URGENT', 'APPROACHING_EXPIRY', 'DUE', 'OVERDUE'] as const) {
      expect(URGENCY_STYLE[urgency].badge).toMatch(/^bg-\S+ text-\S+$/);
      expect(urgencyCopy[urgency].label.length).toBeGreaterThan(0);
    }
    expect(URGENCY_STYLE.NOT_URGENT.badge).toContain('bg-ok');
  });

  it('the badge renders its label text', async () => {
    renderSignedIn('/', <DashboardPage />);
    const list = (await screen.findByRole('heading', { name: 'All food (4)' })).parentElement!.parentElement!;
    for (const label of ['Not urgent', 'Use soon', 'Expected expiry today', 'Past expected expiry']) {
      expect(within(list).getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});

describe('Add food units and notes', () => {
  it('offers exactly the seven units and no free-text unit', () => {
    renderSignedIn('/add', <AddFoodPage />);
    const select = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual(['pcs', 'g', 'kg', 'ml', 'l', 'pack', 'bunch']);
    expect(select.value).toBe('pcs');
  });

  it('sends optional notes', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sampleItems[2], { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Paneer');
    await user.click(screen.getByRole('button', { name: '2 days' }));
    expect(screen.queryByLabelText(/Notes/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add note/ }));
    await user.type(screen.getByLabelText(/Notes/), 'Opened, top shelf');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Paneer', notes: 'Opened, top shelf' }));
    expect(body).not.toHaveProperty('expiryDate');
  });
});

describe('Reminders screen', () => {
  it('marks reminders as read when it opens, and still highlights the new ones', async () => {
    let markedRead = false;
    server.use(
      http.get(`${API_URL}/notifications`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'n1',
              foodId: 'c',
              type: 'APPROACHING_EXPIRY',
              message: 'Spinach: 2 days left.',
              scheduledDate: '2026-09-29',
              status: 'SENT',
              sentAt: '2026-09-29T08:00:00Z',
              readAt: null,
            },
          ],
          total: 1,
          unread: 1,
        }),
      ),
      http.post(`${API_URL}/notifications/read-all`, () => {
        markedRead = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSignedIn('/notifications', <NotificationsPage />);
    expect(await screen.findByText('Spinach: 2 days left.')).toBeInTheDocument();
    await waitFor(() => expect(markedRead).toBe(true));
    expect(screen.getByText('New')).toBeInTheDocument();
  });
});

describe('dashboard layout', () => {
  it('has the name, a bell with the unread count, a settings icon, and a Cook first today row with "See all"', async () => {
    server.use(
      http.get(`${API_URL}/foods/cook-first`, () =>
        HttpResponse.json({
          today: '2026-09-29',
          items: ['a', 'b', 'c', 'e'].map((id) =>
            item({ id, name: `Urgent ${id}`, urgency: 'APPROACHING_EXPIRY', remainingDays: 2 }),
          ),
        }),
      ),
    );
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Hi, Asha Rao' })).toBeInTheDocument();
    expect((await screen.findAllByRole('link', { name: 'Reminders, 2 unread' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings');
    const section = screen.getByRole('region', { name: 'Cook first today' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(4);
    expect(within(section).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/cook-first');
    expect(screen.getAllByRole('link', { name: /Add food/ }).length).toBeGreaterThan(0);
  });
});

describe('Add food form', () => {
  it('focuses the name field, defaults quantity to 1, unit to pcs and the date to today', () => {
    renderSignedIn('/add', <AddFoodPage />);
    expect(screen.getByLabelText('Food')).toHaveFocus();
    expect(screen.getByLabelText('Quantity')).toHaveValue(1);
    expect(screen.getByLabelText('Unit')).toHaveValue('pcs');
    expect((screen.getByLabelText('Added on') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const d of ['1 day', '2 days', '3 days', '5 days', '7 days', '14 days']) {
      expect(screen.getByRole('button', { name: d })).toBeInTheDocument();
    }
  });

  it('shows the live preview as "Expected expiry: <date> (<n> days left)" with the disclaimer', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.click(screen.getByRole('button', { name: '2 days' }));
    expect(screen.getByText(/^Expected expiry: \w{3}, \d{1,2} \w{3} \(2 days left\)$/)).toBeInTheDocument();
    expect(screen.getByText(REQUIRED_LINE)).toBeInTheDocument();
  });
});

describe('Cook First', () => {
  it('explains that nothing needs cooking first, with a way forward, when nothing is urgent', async () => {
    server.use(http.get(`${API_URL}/foods/cook-first`, () => HttpResponse.json({ today: '2026-09-29', items: [] })));
    renderSignedIn('/cook-first', <CookFirstPage />);
    expect(await screen.findByText('Nothing needs cooking first')).toBeInTheDocument();
  });
});

describe('error states', () => {
  it('the Reminders screen shows an error rather than "No reminders yet" when loading fails', async () => {
    server.use(
      http.get(`${API_URL}/notifications`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderSignedIn('/notifications', <NotificationsPage />);
    expect(await screen.findByText('Couldn’t load your reminders.')).toBeInTheDocument();
    expect(screen.queryByText('No reminders yet')).not.toBeInTheDocument();
  });
});
