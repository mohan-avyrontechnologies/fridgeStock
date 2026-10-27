import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { BulkAddPage } from '../pages/BulkAddPage';
import { FridgeStockPage } from '../pages/FridgeStockPage';
import { renderSignedIn } from './render';

/** Phase 1: faster entry. */

describe('reference suggestions on Add Food', () => {
  it('suggests common foods as you type, and picking one fills the unit and where it is kept', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'chick');
    const suggestions = screen.getByRole('group', { name: 'Suggestions' });
    await user.click(within(suggestions).getByRole('button', { name: /Chicken/ }));
    expect(screen.getByLabelText('Food')).toHaveValue('Chicken');
    expect(screen.getByLabelText('Unit')).toHaveValue('g');
    expect(screen.getByLabelText('Kept in')).toHaveValue('FRIDGE');
    expect(screen.getByText(/lasts about 2 days in the fridge/)).toBeInTheDocument();
  });

  it('re-estimates when the storage location changes', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'chick');
    await user.click(
      within(screen.getByRole('group', { name: 'Suggestions' })).getByRole('button', { name: /Chicken/ }),
    );
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FREEZER');
    expect(screen.getByText(/lasts about 270 days in the freezer/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Kept in'), 'PANTRY');
    // Chicken isn't usually kept in the pantry, and meat has no pantry default: a rough estimate.
    expect(screen.getByText('· Rough estimate')).toBeInTheDocument();
  });

  it('sends the storage location with the item', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({}), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Peas');
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FREEZER');
    await user.click(screen.getByRole('button', { name: 'Change estimate' }));
    await user.type(screen.getByLabelText('Lifespan (days)'), '200');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Peas', storage: 'FREEZER', lifespanDays: 200 }));
  });
});

describe('favourites', () => {
  it('shows favourites on Add Food and re-adds one with a single tap', async () => {
    const user = userEvent.setup();
    let added = '';
    server.use(
      http.get(`${API_URL}/favourites`, () =>
        HttpResponse.json({
          items: [{ id: 'f1', name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 5, storage: 'FRIDGE' }],
        }),
      ),
      http.post(`${API_URL}/favourites/:id/add`, ({ params }) => {
        added = String(params.id);
        return HttpResponse.json(item({ name: 'Milk' }), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.click(await screen.findByRole('button', { name: 'Add Milk again' }));
    await waitFor(() => expect(added).toBe('f1'));
    expect(await screen.findByText('Added Milk')).toBeInTheDocument();
  });
});

describe('Undo instead of confirmation dialogs', () => {
  it('Wasted acts at once and the toast offers Undo, which calls the API', async () => {
    const user = userEvent.setup();
    let wasted = false;
    let undone = false;
    server.use(
      http.post(`${API_URL}/foods/c/waste`, () => {
        wasted = true;
        return HttpResponse.json({ food: item({ id: 'c', status: 'WASTED' }), usageRecord: {} });
      }),
      http.post(`${API_URL}/foods/c/undo`, () => {
        undone = true;
        return HttpResponse.json(item({ id: 'c' }));
      }),
    );
    renderSignedIn('/fridgestock', <FridgeStockPage />);
    await user.click(await screen.findByRole('button', { name: 'Mark as wasted: Spinach' }));
    await waitFor(() => expect(wasted).toBe(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Marked as wasted: Spinach')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undone).toBe(true));
    expect(await screen.findByText('Restored: Spinach')).toBeInTheDocument();
  });

  it('Used all in the sheet acts at once, with no confirmation step', async () => {
    const user = userEvent.setup();
    let used = false;
    server.use(
      http.post(`${API_URL}/foods/c/use`, () => {
        used = true;
        return HttpResponse.json({ food: item({ id: 'c', status: 'USED' }), usageRecord: {} });
      }),
    );
    renderSignedIn('/fridgestock', <FridgeStockPage />);
    await user.click(await screen.findByRole('button', { name: 'Mark as used: Spinach' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Mark all as used/ }));
    await waitFor(() => expect(used).toBe(true));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });
});

describe('bulk add', () => {
  it('fills rows from the reference list and sends them in one request, estimating what has no lifespan', async () => {
    const user = userEvent.setup();
    let body: { addedDate: string; items: Record<string, unknown>[] } | undefined;
    server.use(
      http.post(`${API_URL}/foods/bulk`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ items: [item({}), item({})] }, { status: 201 });
      }),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.type(screen.getByLabelText('Item 1 name'), 'Spinach');
    expect(screen.getByLabelText('Item 1 unit')).toHaveValue('bunch');
    expect(screen.getByLabelText('Item 1 lifespan in days')).toHaveValue(null);
    await user.type(screen.getByLabelText('Item 2 name'), 'Peas');
    await user.type(screen.getByLabelText('Item 2 lifespan in days'), '240');
    await user.selectOptions(screen.getByLabelText('Item 2 kept in'), 'FREEZER');
    await user.click(screen.getByRole('button', { name: 'Add 2 items' }));
    await waitFor(() => expect(body?.items).toHaveLength(2));
    expect(body!.items[0]).toMatchObject({ name: 'Spinach', unit: 'bunch', storage: 'FRIDGE' });
    expect(body!.items[0]).not.toHaveProperty('lifespanDays');
    expect(body!.items[1]).toMatchObject({ name: 'Peas', lifespanDays: 240, storage: 'FREEZER' });
    expect(body!.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows a validation error on the right row, without calling the API', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.post(`${API_URL}/foods/bulk`, () => {
        called = true;
        return HttpResponse.json({ items: [] }, { status: 201 });
      }),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.type(screen.getByLabelText('Item 1 name'), 'Spinach');
    await user.type(screen.getByLabelText('Item 2 name'), 'Mystery');
    await user.type(screen.getByLabelText('Item 2 lifespan in days'), '999');
    await user.click(screen.getByRole('button', { name: 'Add 2 items' }));
    expect(await screen.findByText('Lifespan must be a whole number of days from 0 to 365.')).toBeInTheDocument();
    expect(screen.getByLabelText('Item 2 lifespan in days')).toHaveClass('border-danger');
    expect(called).toBe(false);
  });
});
