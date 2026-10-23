import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API_URL } from '../api/client';
import { FoodList } from '../components/FoodCard';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { renderSignedIn } from './render';

/** Automatic expected expiry in the screens: where it came from, the explanation, and "Change estimate". */

const printed = item({
  id: 'p1',
  name: 'Milk',
  expiryDate: '2026-10-01',
  expirySource: 'PRINTED_DATE',
  estimateExplanation: 'The expected expiry is the date printed on the pack (a use-by date).',
  printedDate: '2026-10-01',
  printedDateType: 'USE_BY',
});

describe('food cards', () => {
  it('show a small source label after the expected expiry', () => {
    renderSignedIn('/', <FoodList items={[printed, item({ id: 'c1', name: 'Eggs', expirySource: 'FALLBACK' })]} />);
    expect(screen.getByText(/Expected expiry Thu, 1 Oct · Printed date/)).toBeInTheDocument();
    expect(screen.getByText(/· Rough estimate/)).toBeInTheDocument();
  });
});

describe('Food Details', () => {
  it('explains the expected expiry and shows the printed date', async () => {
    server.use(http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(printed)));
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    expect(await screen.findByText('Why this expected expiry')).toBeInTheDocument();
    expect(screen.getByText(printed.estimateExplanation)).toBeInTheDocument();
    expect(screen.getByText('Estimate source')).toBeInTheDocument();
    expect(screen.getByText(/Thu, 1 Oct \(printed on the pack\)/)).toBeInTheDocument();
  });

  it('editing does not send a lifespan unless "Change estimate" was used, and then it is the person’s own', async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(printed)),
      http.put(`${API_URL}/foods/p1`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(printed);
      }),
    );
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    // The form shows the expected expiry the item has now, and where it came from.
    expect(await screen.findByText(/· Printed date/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).not.toHaveProperty('lifespanDays');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Change estimate' }));
    await user.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.getByText(/· You set this/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ lifespanDays: 7 });
  });
});

describe('Add Food', () => {
  it('sends no lifespan when you never touch the estimate, and sets the place from the catalog', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({}), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Bread');
    // The catalog keeps bread in the pantry, and the form follows until you choose a place yourself.
    expect(screen.getByLabelText('Kept in')).toHaveValue('PANTRY');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Bread', storage: 'PANTRY' });
    expect(body).not.toHaveProperty('lifespanDays');
    expect(body).not.toHaveProperty('printedDate');
  });

  it('keeps the place you chose when the name changes afterwards', async () => {
    const user = userEvent.setup();
    renderSignedIn('/add', <AddFoodPage />);
    await user.selectOptions(screen.getByLabelText('Kept in'), 'FREEZER');
    await user.type(screen.getByLabelText('Food'), 'Bread');
    expect(screen.getByLabelText('Kept in')).toHaveValue('FREEZER');
  });

  it('ignores a date from the pack that is out of range, and says so', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({}), { status: 201 });
      }),
    );
    renderSignedIn('/add', <AddFoodPage />);
    await user.type(screen.getByLabelText('Food'), 'Milk');
    await user.click(screen.getByRole('button', { name: /Add the date from the pack/ }));
    const far = new Date(Date.now() + 900 * 86_400_000).toISOString().slice(0, 10);
    await user.type(screen.getByLabelText('Date on the pack'), far);
    expect(screen.getByText(/more than 2 years away or more than 30 days past/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).not.toHaveProperty('printedDate');
  });
});
