import type { Favourite } from '@cook-first/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { API_URL } from '../api/client';
import { quantityStep } from '../components/FoodForm';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage, recentFoods } from '../pages/AddFoodPage';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { renderSignedIn } from './render';

/** Add Food as a bottom sheet: the camera first, favourites and recents, the quantity stepper and number keyboards. */

const made = (name: string, createdAt: string, over: Partial<ReturnType<typeof item>> = {}) =>
  item({ id: name, name, createdAt, ...over });

function foods(...items: ReturnType<typeof item>[]) {
  server.use(
    http.get(`${API_URL}/foods`, () =>
      HttpResponse.json({
        today: '2026-09-29',
        summary: { NOT_URGENT: items.length, APPROACHING_EXPIRY: 0, DUE: 0, OVERDUE: 0, total: items.length },
        items,
      }),
    ),
  );
}

const favourite = (name: string): Favourite => ({
  id: `f-${name}`,
  name,
  quantity: 1,
  unit: 'pcs',
  lifespanDays: 3,
  storage: 'FRIDGE',
});

describe('the Add food sheet', () => {
  it('is a dialog over the page, with the camera as the first thing in it', async () => {
    renderSignedIn('/add', <AddFoodPage />);
    const sheet = await screen.findByRole('dialog', { name: 'Add food' });
    // The camera comes before the form fields.
    const camera = within(sheet).getByRole('button', { name: 'Use the camera' });
    const food = within(sheet).getByLabelText('Food');
    expect(camera.compareDocumentPosition(food) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closing it with Escape leaves the add screen', async () => {
    const reader = userEvent.setup();
    useAuthStore.setState({
      token: 't',
      user: {
        id: 'u',
        name: 'A',
        email: 'a@b.c',
        timeZone: 'UTC',
        currency: 'USD',
        savePhotos: true,
        notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
        reminderDelivery: { mode: 'DIGEST', hour: 8 },
      },
    });
    function Where() {
      return <p data-testid="where">{useLocation().pathname}</p>;
    }
    render(
      <MemoryRouter initialEntries={['/add']}>
        <Routes>
          <Route path="/add" element={<AddFoodPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const food = await screen.findByLabelText('Food');
    expect(food).toHaveFocus();
    await reader.keyboard('{Escape}');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });
});

describe('the quantity stepper', () => {
  it('has + and - buttons around the number, which can still be typed', async () => {
    const reader = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    const quantity = await screen.findByLabelText('Quantity');
    expect(quantity).toHaveValue(1);
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(quantity).toHaveValue(3);
    await reader.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(quantity).toHaveValue(2);
    await reader.clear(quantity);
    await reader.type(quantity, '7');
    expect(quantity).toHaveValue(7);
  });

  it('can not go to zero or below, and the minus button says so by being disabled', async () => {
    const reader = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await screen.findByLabelText('Quantity');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeEnabled();
  });

  it('steps by 50 for grams and millilitres, by a half for kilos and litres, and by 1 for the rest', async () => {
    expect([
      quantityStep('g'),
      quantityStep('ml'),
      quantityStep('kg'),
      quantityStep('l'),
      quantityStep('pcs'),
      quantityStep('pack'),
      quantityStep('bunch'),
    ]).toEqual([50, 50, 0.5, 0.5, 1, 1, 1]);
    const reader = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    const quantity = await screen.findByLabelText('Quantity');
    await reader.selectOptions(screen.getByLabelText('Unit'), 'g');
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(quantity).toHaveValue(51);
    await reader.selectOptions(screen.getByLabelText('Unit'), 'l');
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(quantity).toHaveValue(51.5);
    await reader.clear(quantity);
    await reader.type(quantity, '1');
    await reader.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(quantity).toHaveValue(0.5);
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
  });

  it('what is saved is the number shown', async () => {
    const reader = userEvent.setup();
    let body: { quantity?: number } = {};
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as never;
        return HttpResponse.json(item({ id: 'n', name: 'Rice' }), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await reader.type(await screen.findByLabelText('Food'), 'Rice');
    await reader.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await reader.click(screen.getByRole('button', { name: '5 days' }));
    await reader.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body.quantity).toBe(2));
  });
});

describe('number keyboards and lifespan quick picks', () => {
  it('quantity and price ask for a decimal keyboard and lifespan for a plain number one', async () => {
    renderSignedIn('/add', <AddFoodPage />);
    expect(await screen.findByLabelText('Quantity')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText(/^Price/)).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Lifespan (days)')).toHaveAttribute('inputmode', 'numeric');
  });

  it('has quick-pick chips for the lifespan, and choosing one fills it in', async () => {
    const reader = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    for (const label of ['1 day', '2 days', '3 days', '5 days', '7 days', '14 days']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
    await reader.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(7);
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('recents', () => {
  it('lists the foods you added most recently, newest first, one of each name, without your favourites', () => {
    const items = [
      made('Milk', '2026-09-20T10:00:00Z'),
      made('Eggs', '2026-09-25T10:00:00Z'),
      made('milk', '2026-09-28T10:00:00Z'),
      made('Oat milk', '2026-09-27T10:00:00Z'),
      made('Bread', '2026-09-26T10:00:00Z'),
    ];
    expect(recentFoods(items, [favourite('Eggs')]).map((r) => r.name)).toEqual(['milk', 'Oat milk', 'Bread']);
  });

  it('shows at most six', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      made(`Food ${i}`, `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`),
    );
    expect(recentFoods(items, [])).toHaveLength(6);
  });

  it('are chips on the sheet, and tapping one fills the form from that food', async () => {
    const reader = userEvent.setup();
    foods(
      made('Greek yoghurt', '2026-09-28T10:00:00Z', { quantity: 2, unit: 'pack', lifespanDays: 9, storage: 'FRIDGE' }),
      made('Peas', '2026-09-27T10:00:00Z', { quantity: 500, unit: 'g', lifespanDays: 120, storage: 'FREEZER' }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    const group = await screen.findByRole('region', { name: 'Recent' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Greek yoghurt', 'Peas']);
    await reader.click(within(group).getByRole('button', { name: 'Fill in Peas' }));
    expect(screen.getByLabelText('Food')).toHaveValue('Peas');
    expect(screen.getByLabelText('Quantity')).toHaveValue(500);
    expect(screen.getByLabelText('Unit')).toHaveValue('g');
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(120);
    expect(screen.getByLabelText('Kept in')).toHaveValue('FREEZER');
  });

  it('are left out when there is nothing yet', async () => {
    foods();
    renderSignedIn('/add', <AddFoodPage />);
    await screen.findByLabelText('Food');
    expect(screen.queryByRole('region', { name: 'Recent' })).not.toBeInTheDocument();
  });

  it('come after the favourites', async () => {
    server.use(http.get(`${API_URL}/favourites`, () => HttpResponse.json({ items: [favourite('Oat milk')] })));
    foods(made('Peas', '2026-09-27T10:00:00Z'));
    renderSignedIn('/add', <AddFoodPage />);
    const favourites = await screen.findByRole('region', { name: 'Favourites' });
    const recent = await screen.findByRole('region', { name: 'Recent' });
    expect(favourites.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    void useFoodStore;
  });
});
