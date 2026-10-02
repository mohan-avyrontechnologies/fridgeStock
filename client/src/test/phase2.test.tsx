import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { renderSignedIn } from './render';

/** Phase 2: realistic estimates. */

const learned = [{ name: 'Chicken', storage: 'FRIDGE', unit: 'g', days: 3, basedOn: 4 }];

function renderDetail(food = item({ id: 'm1', name: 'Milk', addedDate: '2026-01-01' })) {
  server.use(http.get(`${API_URL}/foods/m1`, () => HttpResponse.json(food)));
  return renderSignedIn('/foods/m1', <FoodDetailPage />, '/foods/:id');
}

describe('learned lifespans on Add Food', () => {
  it('puts your usual lifespan first, marked with a star, and explains where it came from', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API_URL}/suggestions/lifespans`, () => HttpResponse.json({ items: learned })));
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'chick');
    const chip = await within(screen.getByRole('group', { name: 'Suggestions' })).findByRole('button', {
      name: /your usual.*Chicken/,
    });
    await user.click(chip);
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(3);
    expect(
      screen.getByText('You usually set 3 days for this (from your last 4). Change it if you like.'),
    ).toBeInTheDocument();
    // Your usual is per location: the freezer falls back to the reference list.
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FREEZER');
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(270);
  });
});

describe('Opened', () => {
  it('prefills the typical opened lifespan and sends it', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods/m1/open`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ id: 'm1', name: 'Milk', openedDate: '2026-09-29', expiryDate: '2026-10-03' }));
      }),
    );
    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Mark as opened' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark Milk as opened' });
    expect(within(dialog).getByLabelText('Days it lasts once opened')).toHaveValue(4);
    await user.click(within(dialog).getByRole('button', { name: 'Mark as opened' }));
    await waitFor(() => expect(body).toMatchObject({ daysLeft: 4 }));
    expect(await screen.findByText(/Marked Milk as opened\. Expected expiry/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as not opened' })).toBeInTheDocument();
  });

  it('asks for days when the food has no typical opened lifespan', async () => {
    const user = userEvent.setup();
    renderDetail(item({ id: 'm1', name: 'Mystery stew', addedDate: '2026-01-01' }));
    await user.click(await screen.findByRole('button', { name: 'Mark as opened' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as opened' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter how many days it lasts once opened.');
  });

  it('can be marked as not opened', async () => {
    const user = userEvent.setup();
    let undone = false;
    server.use(
      http.delete(`${API_URL}/foods/m1/open`, () => {
        undone = true;
        return HttpResponse.json(item({ id: 'm1', name: 'Milk' }));
      }),
    );
    renderDetail(item({ id: 'm1', name: 'Milk', openedDate: '2026-09-29' }));
    await user.click(await screen.findByRole('button', { name: 'Mark as not opened' }));
    await waitFor(() => expect(undone).toBe(true));
    expect(await screen.findByText('Milk is no longer marked as opened')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as opened' })).toBeInTheDocument();
  });
});

describe('Move', () => {
  it('suggests the lifespan for the new location and sends it', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods/m1/move`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ id: 'm1', name: 'Chicken', storage: 'FREEZER', expiryDate: '2027-06-26' }));
      }),
    );
    renderDetail(item({ id: 'm1', name: 'Chicken', unit: 'g' }));
    await user.click(await screen.findByRole('button', { name: 'Move' }));
    const dialog = screen.getByRole('dialog', { name: 'Move Chicken' });
    expect(within(dialog).queryByRole('button', { name: 'Fridge' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Freezer' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText(/Days it lasts in the freezer/)).toHaveValue(270);
    await user.click(within(dialog).getByRole('button', { name: 'Pantry' }));
    expect(within(dialog).getByLabelText(/Days it lasts in the pantry/)).toHaveValue(null);
    expect(within(dialog).getByText('Not usually kept in the pantry. Enter your own lifespan.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Freezer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(body).toEqual({ storage: 'FREEZER', daysLeft: 270 }));
    expect(await screen.findByText(/Moved Chicken to the freezer\. Expected expiry/)).toBeInTheDocument();
  });
});
