import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { addDays, hasBannedWording, type Insights, type InsightsPeriod, type InsightsWeek } from '@fridgestock/shared';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { InsightsPage } from '../pages/InsightsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

/** Phase 5: insights. The API is faked with MSW. */

const period = (overrides: Partial<InsightsPeriod> = {}): InsightsPeriod => ({
  used: 0,
  wasted: 0,
  wasteRate: null,
  savedValue: 0,
  lostValue: 0,
  pricedEntries: 0,
  ...overrides,
});

const weeks = (last: Partial<InsightsPeriod> = {}): InsightsWeek[] =>
  Array.from({ length: 8 }, (_, i) => ({
    from: addDays('2026-08-05', i * 7),
    to: addDays('2026-08-11', i * 7),
    ...period(i === 7 ? last : {}),
  }));

const insights = (overrides: Partial<Insights> = {}): Insights => ({
  today: '2026-09-29',
  thisWeek: period(),
  lastWeek: period(),
  last30Days: period(),
  weeks: weeks(),
  topWasted: [],
  tips: [],
  ...overrides,
});

const serve = (data: Insights) => server.use(http.get(`${API_URL}/insights`, () => HttpResponse.json(data)));

describe('Insights page', () => {
  it('shows an empty state when nothing has been used or wasted', async () => {
    serve(insights());
    renderSignedIn('/insights', <InsightsPage />);
    expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('shows an error when it cannot load', async () => {
    server.use(http.get(`${API_URL}/insights`, () => HttpResponse.json({}, { status: 500 })));
    renderSignedIn('/insights', <InsightsPage />);
    expect(await screen.findByText(/Couldn’t load your insights/)).toBeInTheDocument();
  });

  it('shows used and wasted this week, the waste rate and last week', async () => {
    serve(
      insights({
        thisWeek: period({ used: 6, wasted: 2, wasteRate: 0.25 }),
        lastWeek: period({ used: 4, wasted: 1, wasteRate: 0.2 }),
        weeks: weeks({ used: 6, wasted: 2 }),
      }),
    );
    renderSignedIn('/insights', <InsightsPage />);
    const section = (await screen.findByRole('heading', { name: 'This week' })).closest('section')!;
    expect(within(section).getByText('6')).toBeInTheDocument();
    expect(within(section).getByText('2')).toBeInTheDocument();
    expect(within(section).getByText(/25% of the food you finished this week was wasted\./)).toBeInTheDocument();
    expect(within(section).getByText(/Last week: 4 used, 1 wasted\./)).toBeInTheDocument();
  });

  it('hides the money section until some entries have a price, then shows it in the chosen currency', async () => {
    serve(insights({ thisWeek: period({ used: 1 }), weeks: weeks({ used: 1 }) }));
    const first = renderSignedIn('/insights', <InsightsPage />);
    await screen.findByRole('heading', { name: 'This week' });
    expect(screen.queryByRole('heading', { name: 'Money' })).not.toBeInTheDocument();
    first.unmount();

    serve(
      insights({
        thisWeek: period({ used: 1, wasted: 1, savedValue: 4.5, lostValue: 2, pricedEntries: 2 }),
        last30Days: period({ used: 1, wasted: 1, savedValue: 4.5, lostValue: 2, pricedEntries: 2 }),
        weeks: weeks({ used: 1, wasted: 1 }),
      }),
    );
    renderSignedIn('/insights', <InsightsPage />);
    const money = (await screen.findByRole('heading', { name: 'Money' })).closest('section')!;
    expect(within(money).getAllByText('$4.50')).toHaveLength(2);
    expect(within(money).getAllByText('$2.00')).toHaveLength(2);
  });

  it('draws eight weeks with a table for screen readers', async () => {
    serve(insights({ thisWeek: period({ used: 3 }), weeks: weeks({ used: 3 }) }));
    renderSignedIn('/insights', <InsightsPage />);
    await screen.findByRole('heading', { name: 'Last 8 weeks' });
    expect(screen.getByRole('img', { name: /used and wasted in each of the last 8 weeks/ })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(9); // header + 8 weeks
  });

  it('lists the most wasted foods and the tips', async () => {
    const tips = [
      { id: 'repeat-waste', text: 'You have wasted Spinach 3 times in the last 30 days. Try buying less of it.' },
      { id: 'add-prices', text: 'Add a price when you add food to see how much you save and lose each week.' },
    ];
    serve(
      insights({
        thisWeek: period({ wasted: 3, wasteRate: 1 }),
        weeks: weeks({ wasted: 3 }),
        topWasted: [{ name: 'Spinach', count: 3, lostValue: 0 }],
        tips,
      }),
    );
    renderSignedIn('/insights', <InsightsPage />);
    const top = (await screen.findByRole('heading', { name: /Wasted most/ })).closest('section')!;
    expect(within(top).getByText('Spinach')).toBeInTheDocument();
    expect(within(top).getByText('3 times')).toBeInTheDocument();
    for (const tip of tips) {
      expect(screen.getByText(tip.text)).toBeInTheDocument();
      expect(hasBannedWording(tip.text)).toBe(false);
    }
  });
});

describe('price on Add Food and Food Details', () => {
  it('sends an optional price with the item, and nothing when it is left blank', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(item({}), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Peas');
    await user.type(screen.getByLabelText('Price (USD, optional)'), '3.25');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: 'Peas', price: 3.25 });
  });

  it('rejects a negative price with the shared message', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Peas');
    await user.type(screen.getByLabelText('Price (USD, optional)'), '-2');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    expect(await screen.findByText('Price must be a number from 0 to 100,000.')).toBeInTheDocument();
  });

  it('shows the price on an item that has one', async () => {
    server.use(http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1', name: 'Cheddar', price: 6 }))));
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    expect(await screen.findByText('$6.00')).toBeInTheDocument();
  });
});

describe('currency setting', () => {
  it('saves the chosen currency', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.put(`${API_URL}/auth/me`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ user: { ...useAuthStore.getState().user, currency: 'CAD' } });
      }),
    );
    renderSignedIn('/settings', <SettingsPage />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Currency' }), 'CAD');
    await waitFor(() => expect(body).toEqual({ currency: 'CAD' }));
    await waitFor(() => expect(useAuthStore.getState().user?.currency).toBe('CAD'));
  });
});
