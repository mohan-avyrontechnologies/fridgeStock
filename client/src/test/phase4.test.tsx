import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MealPlan, ShoppingItem } from '@cook-first/shared';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { CookFirstPage } from '../pages/CookFirstPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { PlanPage } from '../pages/PlanPage';
import { ShoppingPage } from '../pages/ShoppingPage';
import { useAiStore } from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

/** Phase 4: using the food. The API is faked with MSW; AI answers are canned. */

const aiOn = (usedToday = 2) =>
  server.use(http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday })));

const ideas = {
  basedOn: [
    { id: 'b', name: 'Yoghurt' },
    { id: 'c', name: 'Spinach' },
  ],
  recipes: [
    {
      title: 'Spinach and yoghurt dip',
      minutes: 10,
      uses: [
        { id: 'b', name: 'Yoghurt' },
        { id: 'c', name: 'Spinach' },
      ],
      steps: ['Wilt the spinach.', 'Stir into the yoghurt.'],
    },
  ],
};

describe('recipe ideas on Cook First', () => {
  it('are hidden when AI is off', async () => {
    useAiStore.setState({ status: null });
    renderSignedIn('/cook-first', <CookFirstPage />);
    expect(await screen.findByText('Spinach')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest recipes' })).not.toBeInTheDocument();
  });

  it('show ideas built from the Cook First list, with the AI note and the allowance left', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: null });
    aiOn();
    server.use(http.post(`${API_URL}/ai/recipes`, () => HttpResponse.json(ideas)));
    renderSignedIn('/cook-first', <CookFirstPage />);
    expect(await screen.findByText('18 of 20 AI suggestions left today')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suggest recipes' }));
    const card = (await screen.findByRole('heading', { name: 'Spinach and yoghurt dip' })).closest('li')!;
    expect(within(card).getByText('About 10 min')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Yoghurt' })).toHaveAttribute('href', '/food/b');
    expect(within(card).getByText('Wilt the spinach.')).toBeInTheDocument();
    expect(screen.getByText(/These are AI suggestions built from your Cook First list/)).toBeInTheDocument();
  });

  it('show the server’s message when today’s allowance is used up', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: null });
    aiOn(20);
    server.use(
      http.post(`${API_URL}/ai/recipes`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'You’ve used all 20 AI suggestions for today. Try again tomorrow.',
            },
          },
          { status: 429 },
        ),
      ),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Suggest recipes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You’ve used all 20 AI suggestions for today.');
  });
});

function renderAddWithState(state: unknown) {
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
    <MemoryRouter initialEntries={[{ pathname: '/add', state }]}>
      <Routes>
        <Route path="/add" element={<AddFoodPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('leftovers', () => {
  it('"Save leftovers" on a recipe opens Add Food with the name and a short lifespan', async () => {
    renderAddWithState({ name: 'Leftover spinach and yoghurt dip', leftover: true });
    expect(screen.getByLabelText('Food')).toHaveValue('Leftover spinach and yoghurt dip');
    expect(screen.getByRole('checkbox', { name: /These are leftovers/ })).toBeChecked();
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(3);
  });

  it('ticking "These are leftovers" suggests a short lifespan per location and sends the flag', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ leftover: true }), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Leftover curry');
    await user.click(screen.getByRole('checkbox', { name: /These are leftovers/ }));
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(3);
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FREEZER');
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(60);
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FRIDGE');
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(3);

    await user.clear(screen.getByLabelText('Lifespan (days)'));
    await user.type(screen.getByLabelText('Lifespan (days)'), '6');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Leftovers can have a lifespan of at most 4 days, unless they are frozen.'),
    ).toBeInTheDocument();
    expect(body).toBeUndefined();

    await user.clear(screen.getByLabelText('Lifespan (days)'));
    await user.type(screen.getByLabelText('Lifespan (days)'), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Leftover curry', leftover: true, lifespanDays: 2 }));
  });

  it('editing an item keeps where it is kept (it used to reset to the fridge)', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    const peas = item({ id: 'p1', name: 'Peas', storage: 'FREEZER', lifespanDays: 200, addedDate: '2026-09-01' });
    server.use(
      http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(peas)),
      http.put(`${API_URL}/foods/p1`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(peas);
      }),
    );
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Kept in')).toHaveValue('FREEZER');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(body).toMatchObject({ storage: 'FREEZER', leftover: false }));
  });
});

const chicken = {
  id: 'f1',
  name: 'Chicken',
  quantity: 500,
  unit: 'g',
  expiryDate: '2026-09-30',
  urgency: 'APPROACHING_EXPIRY',
};
const shopping = (overrides: Partial<ShoppingItem>): ShoppingItem => ({
  id: 's1',
  name: 'Chicken breasts',
  quantity: null,
  unit: null,
  checked: false,
  createdAt: '2026-09-29T10:00:00Z',
  atHome: [],
  ...overrides,
});

describe('shopping list', () => {
  it('warns about food already at home, with its expected expiry', async () => {
    server.use(
      http.get(`${API_URL}/shopping`, () =>
        HttpResponse.json({
          items: [
            shopping({ atHome: [chicken as ShoppingItem['atHome'][number]] }),
            shopping({ id: 's2', name: 'Flour', checked: true }),
          ],
        }),
      ),
    );
    renderSignedIn('/shopping', <ShoppingPage />);
    expect(
      await screen.findByRole('link', { name: 'Already at home: Chicken (500 g), expected expiry Wed, 30 Sep' }),
    ).toHaveAttribute('href', '/food/f1');
    expect(screen.getByRole('heading', { name: 'To buy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bought' })).toBeInTheDocument();
  });

  it('adds, ticks off, removes, and clears bought items', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(
      http.get(`${API_URL}/shopping`, () =>
        HttpResponse.json({
          items: [shopping({ id: 's1', name: 'Apples' }), shopping({ id: 's2', name: 'Jam', checked: true })],
        }),
      ),
      http.post(`${API_URL}/shopping`, async ({ request }) => {
        calls.push(`POST ${JSON.stringify(await request.json())}`);
        return HttpResponse.json(
          shopping({ id: 's3', name: 'Milk', atHome: [chicken as ShoppingItem['atHome'][number]] }),
          {
            status: 201,
          },
        );
      }),
      http.put(`${API_URL}/shopping/:id`, async ({ request, params }) => {
        calls.push(`PUT ${params.id} ${JSON.stringify(await request.json())}`);
        return HttpResponse.json(shopping({}));
      }),
      http.delete(`${API_URL}/shopping/:id`, ({ params }) => {
        calls.push(`DELETE ${params.id}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${API_URL}/shopping/clear-checked`, () => {
        calls.push('CLEAR');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderSignedIn('/shopping', <ShoppingPage />);
    await user.type(await screen.findByLabelText('Item'), 'Milk');
    await user.type(screen.getByLabelText('How many (optional)'), '2');
    await user.selectOptions(screen.getByLabelText('Unit (optional)'), 'l');
    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(await screen.findByText('Added Milk. You already have some at home.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Bought Apples' }));
    await user.click(screen.getByRole('button', { name: 'Remove Jam' }));
    await user.click(screen.getByRole('button', { name: 'Clear bought items' }));
    await waitFor(() =>
      expect(calls).toEqual([
        'POST {"name":"Milk","quantity":2,"unit":"l"}',
        'PUT s1 {"checked":true}',
        'DELETE s2',
        'CLEAR',
      ]),
    );
  });

  it('asks for a name before adding', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_URL}/shopping`, () => HttpResponse.json({ items: [] })));
    renderSignedIn('/shopping', <ShoppingPage />);
    await user.click(await screen.findByRole('button', { name: 'Add to list' }));
    expect(screen.getByText('Enter what you need to buy.')).toBeInTheDocument();
    expect(screen.getByText('Your shopping list is empty.')).toBeInTheDocument();
  });
});

const plan = (): MealPlan => ({
  today: '2026-09-29',
  days: ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(
    (date) => ({
      date,
      entry: date === '2026-09-29' ? { title: 'Omelette', foods: [{ id: 'd', name: 'Eggs', status: 'ACTIVE' }] } : null,
    }),
  ),
});

describe('meal plan', () => {
  it('shows the week and plans a meal with your own food', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: null });
    let put: { date: string; body: unknown } | undefined;
    server.use(
      http.get(`${API_URL}/meal-plan`, () => HttpResponse.json(plan())),
      http.put(`${API_URL}/meal-plan/:date`, async ({ request, params }) => {
        put = { date: String(params.date), body: await request.json() };
        return HttpResponse.json({ title: 'Spinach pasta', foods: [] });
      }),
    );
    renderSignedIn('/plan', <PlanPage />);
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Omelette')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thu, 1 Oct' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest meals for empty days' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Plan a meal' })[0]!);
    await user.type(screen.getByLabelText('Meal'), 'Spinach pasta');
    await user.click(await screen.findByRole('button', { name: 'Spinach' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toEqual({ date: '2026-09-30', body: { title: 'Spinach pasta', foodIds: ['c'] } }));
  });

  it('AI suggestions are a draft: nothing is saved until "Add these to my plan"', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: null });
    aiOn();
    const saved: string[] = [];
    server.use(
      http.get(`${API_URL}/meal-plan`, () => HttpResponse.json(plan())),
      http.post(`${API_URL}/ai/meal-plan`, () =>
        HttpResponse.json({
          days: [
            { date: '2026-09-30', title: 'Spinach pasta', foods: [{ id: 'c', name: 'Spinach' }] },
            { date: '2026-10-01', title: 'Bean chilli', foods: [] },
          ],
        }),
      ),
      http.put(`${API_URL}/meal-plan/:date`, ({ params }) => {
        saved.push(String(params.date));
        return HttpResponse.json({ title: 'x', foods: [] });
      }),
    );
    renderSignedIn('/plan', <PlanPage />);
    await user.click(await screen.findByRole('button', { name: 'Suggest meals for empty days' }));
    const draft = (await screen.findByRole('heading', { name: 'Suggested meals' })).closest('section')!;
    expect(within(draft).getByText(/Spinach pasta/)).toBeInTheDocument();
    expect(saved).toEqual([]);
    await user.click(within(draft).getByRole('button', { name: 'Add these to my plan' }));
    await waitFor(() => expect(saved).toEqual(['2026-09-30', '2026-10-01']));
    expect(await screen.findByText('Added to your plan')).toBeInTheDocument();
  });
});
