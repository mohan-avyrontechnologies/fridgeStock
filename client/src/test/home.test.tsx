import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { DashboardPage } from '../pages/DashboardPage';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { renderSignedIn } from './render';

/** Home: the "Cook first today" panel, the location chips and the tab bar. The API is faked with MSW. */

const urgent = [
  item({ id: 'a', name: 'Salmon', urgency: 'OVERDUE', remainingDays: -1, expiryDate: '2026-09-28', storage: 'FRIDGE' }),
  item({ id: 'b', name: 'Chicken', urgency: 'DUE', remainingDays: 0, expiryDate: '2026-09-29', storage: 'FRIDGE' }),
  item({
    id: 'c',
    name: 'Peas',
    urgency: 'APPROACHING_EXPIRY',
    remainingDays: 2,
    expiryDate: '2026-10-01',
    storage: 'FREEZER',
  }),
];
const calm = [
  item({
    id: 'd',
    name: 'Rice',
    urgency: 'NOT_URGENT',
    remainingDays: 90,
    expiryDate: '2026-12-28',
    storage: 'PANTRY',
  }),
];

function foods(items: typeof urgent, cookFirst = items.filter((i) => i.urgency !== 'NOT_URGENT')) {
  server.use(
    http.get(`${API_URL}/foods`, () =>
      HttpResponse.json({
        today: '2026-09-29',
        summary: { NOT_URGENT: 0, APPROACHING_EXPIRY: 0, DUE: 0, OVERDUE: 0, total: items.length },
        items,
      }),
    ),
    http.get(`${API_URL}/foods/cook-first`, () => HttpResponse.json({ today: '2026-09-29', items: cookFirst })),
  );
}

const plan = (meals: Record<string, { meal: string; title: string; foods: unknown[] }>) =>
  server.use(
    http.get(`${API_URL}/meal-plan`, () =>
      HttpResponse.json({ today: '2026-09-29', days: [{ date: '2026-09-29', entry: meals.dinner ?? null, meals }] }),
    ),
  );

/** Pins the clock (only Date) to a UTC hour on 29 September, so "the current meal" is known. */
const at = (hour: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`2026-09-29T${String(hour).padStart(2, '0')}:00:00Z`));
};

afterEach(() => vi.useRealTimers());

describe('the "Cook first today" panel', () => {
  it('is the first thing on Home, with the most urgent food as large cards in a row', async () => {
    foods([...urgent, ...calm]);
    renderSignedIn('/', <DashboardPage />);
    const panel = await screen.findByRole('region', { name: 'Cook first today' });
    const row = within(panel).getByRole('list', { name: 'Food to cook first' });
    const cards = within(row).getAllByRole('listitem');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Salmon',
      'Chicken',
      'Peas',
    ]);
    // Each card has its name, a badge with icon and label, and the days left in words.
    expect(within(cards[0]!).getByText('Past expected expiry')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('1 day past expected expiry')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Expected expiry today')).toBeInTheDocument();
    expect(within(cards[2]!).getByText('2 days left')).toBeInTheDocument();
    expect(within(cards[2]!).getByRole('link')).toHaveAttribute('href', '/food/c');
    // The panel comes before the inventory.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Cook first today')).toBeLessThan(headings.findIndex((h) => h?.startsWith('All food')));
  });

  it('has no more than six cards, and "See all" opens Cook First', async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      item({
        id: `x${i}`,
        name: `Item ${i}`,
        urgency: 'APPROACHING_EXPIRY',
        remainingDays: 2,
        expiryDate: '2026-10-01',
      }),
    );
    foods(many);
    renderSignedIn('/', <DashboardPage />);
    const panel = await screen.findByRole('region', { name: 'Cook first today' });
    expect(within(panel).getAllByRole('listitem')).toHaveLength(6);
    expect(within(panel).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/cook-first');
  });

  it('suggests the planned meal for the current meal', async () => {
    at(12); // lunch
    foods(urgent);
    plan({
      lunch: { meal: 'lunch', title: 'Fish pie', foods: [] },
      dinner: { meal: 'dinner', title: 'Stew', foods: [] },
    });
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByText('Planned for lunch: Fish pie')).toBeInTheDocument();
    expect(screen.queryByText(/Stew/)).not.toBeInTheDocument();
  });

  it('with nothing planned, suggests starting with the two most urgent items', async () => {
    at(19); // dinner
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByText('For dinner, start with Salmon and Chicken.')).toBeInTheDocument();
  });

  it('it is breakfast in the morning, and in the person’s own time zone', async () => {
    at(7);
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    expect(await screen.findByText('For breakfast, start with Salmon and Chicken.')).toBeInTheDocument();
  });

  describe('when nothing is urgent', () => {
    beforeEach(() => foods(calm, []));

    it('is a calm message with "Plan a meal" and "Add food"', async () => {
      renderSignedIn('/', <DashboardPage />);
      const panel = await screen.findByRole('region', { name: 'Cook first today' });
      expect(within(panel).getByText('Nothing needs cooking first')).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Plan a meal' })).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Add food' })).toBeInTheDocument();
      expect(within(panel).queryByRole('list', { name: 'Food to cook first' })).not.toBeInTheDocument();
    });
  });

  describe('its buttons', () => {
    function Where() {
      const location = useLocation();
      return <p data-testid="where">{location.pathname + location.search}</p>;
    }
    function renderHome() {
      useAuthStore.setState({
        token: 't',
        user: {
          id: 'u',
          name: 'Asha Rao',
          email: 'a@b.c',
          timeZone: 'UTC',
          currency: 'USD',
          savePhotos: true,
          notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
          reminderDelivery: { mode: 'DIGEST', hour: 8 },
        },
      });
      void useFoodStore.getState().refresh();
      return render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it('"Cooked something" opens the leftovers form', async () => {
      const user = userEvent.setup();
      foods(urgent);
      renderHome();
      await user.click(await screen.findByRole('button', { name: 'Cooked something' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/add?leftover=1');
    });

    it('"Plan a meal" and "Add food" go to the meal plan and the add screen', async () => {
      const user = userEvent.setup();
      foods(calm, []);
      renderHome();
      await user.click(await screen.findByRole('button', { name: 'Plan a meal' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/plan');
    });
  });
});

describe('location chips and the inventory', () => {
  beforeEach(() => foods([...urgent, ...calm]));

  it('has All, Fridge, Freezer and Pantry, with All chosen, and the full list in priority order', async () => {
    renderSignedIn('/', <DashboardPage />);
    const group = await screen.findByRole('group', { name: 'Where it’s kept' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All', 'Fridge', 'Freezer', 'Pantry']);
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('region', { name: 'All food (4)' });
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Salmon', 'Chicken', 'Peas', 'Rice']);
  });

  it('shows only what is kept in the chosen place, keeping the priority order', async () => {
    const user = userEvent.setup();
    renderSignedIn('/', <DashboardPage />);
    await user.click(await screen.findByRole('button', { name: 'Fridge' }));
    const list = screen.getByRole('region', { name: 'Fridge (2)' });
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Salmon', 'Chicken']);
    await user.click(screen.getByRole('button', { name: 'Freezer' }));
    expect(
      within(screen.getByRole('region', { name: 'Freezer (1)' })).getByRole('heading', { level: 3, name: 'Peas' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('region', { name: 'All food (4)' })).toBeInTheDocument();
  });

  it('says so, with a way forward, when a place is empty', async () => {
    const user = userEvent.setup();
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    await user.click(await screen.findByRole('button', { name: 'Pantry' }));
    expect(screen.getByText('Nothing in the pantry yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add food' }).length).toBeGreaterThan(0);
  });

  it('only filters the list: the Cook first today panel still shows every urgent item', async () => {
    const user = userEvent.setup();
    renderSignedIn('/', <DashboardPage />);
    await user.click(await screen.findByRole('button', { name: 'Pantry' }));
    const panel = screen.getByRole('region', { name: 'Cook first today' });
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('the bottom tab bar', () => {
  const bottomNav = () => screen.getAllByRole('navigation', { name: 'Main' }).at(-1)!;

  it('has Home, Cook First, a large Add button in the middle, Shopping and More', async () => {
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    await screen.findByRole('region', { name: 'Cook first today' });
    const items = within(bottomNav()).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.textContent)).toEqual(['Home', 'Cook First3', 'Add food', 'Shopping', 'More']);
    expect(within(items[2]!).getByRole('link', { name: 'Add food' })).toHaveAttribute('href', '/add');
    expect(within(items[1]!).getByRole('link')).toHaveAttribute('href', '/cook-first');
    expect(within(items[3]!).getByRole('link')).toHaveAttribute('href', '/shopping');
  });

  it('More opens Meal plan, Settings, History, Insights and Household, and closes after a choice', async () => {
    const user = userEvent.setup();
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    await screen.findByRole('region', { name: 'Cook first today' });
    await user.click(within(bottomNav()).getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Meal plan', '/plan'],
      ['Settings', '/settings'],
      ['History', '/history'],
      ['Insights', '/insights'],
      ['Household', '/household'],
    ]);
    await user.click(within(sheet).getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument());
  });

  it('More closes with Escape, and focus goes back to the More button', async () => {
    const user = userEvent.setup();
    foods(urgent);
    renderSignedIn('/', <DashboardPage />);
    await screen.findByRole('region', { name: 'Cook first today' });
    const more = within(bottomNav()).getByRole('button', { name: 'More' });
    await user.click(more);
    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
