import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { urgencyCopy } from '../copy';
import { AddFoodPage } from '../pages/AddFoodPage';
import { CookFirstPage } from '../pages/CookFirstPage';
import { DashboardPage } from '../pages/DashboardPage';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';
import { item, sampleItems, server } from './server';

describe('Dashboard', () => {
  it('shows every item in server order with its urgency label and counts', async () => {
    renderSignedIn('/', <DashboardPage />);
    const all = await screen.findByRole('heading', { name: 'All food (4)' });
    const list = all.parentElement!.parentElement!.querySelector('ul')!;
    const names = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('a span')!.textContent);
    expect(names).toEqual(['Bread', 'Yoghurt', 'Spinach', 'Eggs']);

    expect(within(list).getByText('Past expected expiry')).toBeInTheDocument();
    expect(within(list).getByText('Expected expiry today', { selector: 'span' })).toBeInTheDocument();
    expect(within(list).getByText('Use soon')).toBeInTheDocument();
    expect(within(list).getByText('Not urgent')).toBeInTheDocument();
    expect(within(list).getByText('Expected expiry was yesterday', { exact: false })).toBeInTheDocument();
  });

  it('never uses the word "safe" in anything it renders', async () => {
    const { container } = renderSignedIn('/', <DashboardPage />);
    await screen.findByRole('heading', { name: 'All food (4)' });
    expect(container.textContent).not.toMatch(/\bsafe\b/i);
  });

  it('shows an empty state for a new user', async () => {
    server.use(
      http.get('/api/foods', () =>
        HttpResponse.json({
          today: '2026-09-29',
          summary: { NOT_URGENT: 0, USE_SOON: 0, DUE_TODAY: 0, PAST_EXPECTED_EXPIRY: 0 },
          items: [],
        }),
      ),
      http.get('/api/foods/cook-first', () => HttpResponse.json({ today: '2026-09-29', items: [] })),
    );
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('signs out when the token is rejected', async () => {
    server.use(
      http.get('/api/foods', () =>
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
      http.post('/api/foods/c/use', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ food: item({ id: 'c', quantity: 0.5 }), usageRecord: {} });
      }),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Update Spinach' }));
    const dialog = screen.getByRole('dialog', { name: 'Spinach' });
    await user.click(within(dialog).getByRole('button', { name: /Used some/ }));
    await user.type(within(dialog).getByLabelText(/How much did you use/), '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toEqual({ action: 'PARTIALLY_USED', quantityUsed: 0.5 }));
  });
});

describe('Add food', () => {
  it('validates required fields before calling the API', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Food name is required.')).toBeInTheDocument();
    expect(screen.getByText('Lifespan must be zero or a positive number of days.')).toBeInTheDocument();
  });

  it('previews expected expiry and sends the five fields', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/foods', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sampleItems[2], { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Spinach');
    await user.click(screen.getByRole('button', { name: 'bunch' }));
    await user.click(screen.getByRole('button', { name: '2 days' }));
    expect(screen.getByText(/Expected expiry in 2 days/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Spinach', quantity: 1, unit: 'bunch', lifespanDays: 2 });
    expect(body!.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows the server validation message on the right field', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/foods', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Food name must be at most 100 characters.', field: 'name' } },
          { status: 400 },
        ),
      ),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'x');
    await user.click(screen.getByRole('button', { name: '3 days' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Food name must be at most 100 characters.')).toBeInTheDocument();
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
