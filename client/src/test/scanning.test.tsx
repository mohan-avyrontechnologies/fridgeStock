import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceiptDraft } from '@cook-first/shared';
import { API_URL } from '../api/client';
import { scaledSize } from '../lib/image';
import { server } from '../mocks/server';
import { BulkAddPage } from '../pages/BulkAddPage';
import { useAiStore } from '../stores/aiStore';
import { renderSignedIn } from './render';

// The browser's canvas and image decoding aren't in the test environment; the real function is tested below.
vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  photoForUpload: vi.fn(async () => ({ mediaType: 'image/jpeg' as const, image: 'QUJD', blob: new Blob(['x']) })),
}));

/** Phase 6: barcode and receipt scanning. The API is faked with MSW. */

describe('scaling a photo', () => {
  it('shrinks the longest side to the limit and keeps the shape', () => {
    expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never enlarges a small photo', () => {
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('never goes below one pixel', () => {
    expect(scaledSize(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('scanning a receipt on Bulk add', () => {
  const aiOn = (enabled: boolean) =>
    useAiStore.setState({ status: { enabled, photoCheck: false, dailyLimit: 20, usedToday: 0 } });

  beforeEach(() => aiOn(true));
  afterEach(() => aiOn(false));

  const draft: ReceiptDraft = {
    purchaseDate: '2026-09-28',
    items: [
      { name: 'Milk', quantity: 2, unit: 'l', price: 2.4 },
      { name: 'Potatoes', quantity: 1, unit: 'kg', price: 3.1 },
      { name: 'Zorblax', quantity: 3, unit: 'pcs', price: null },
    ],
  };

  const receiptReturns = (result: ReceiptDraft | { status: number }, bodies: unknown[] = []) =>
    server.use(
      http.post(`${API_URL}/parse/receipt`, async ({ request }) => {
        bodies.push(await request.json());
        return 'status' in result
          ? HttpResponse.json(
              { error: { code: 'AI_UNAVAILABLE', message: 'Couldn’t get suggestions right now. Try again later.' } },
              { status: result.status },
            )
          : HttpResponse.json(result);
      }),
    );

  const photo = () => new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

  it('is not offered when AI is off', async () => {
    aiOn(false);
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: false, dailyLimit: 20, usedToday: 0 })),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    expect(
      await screen.findByRole('button', { name: 'Add 0 items' }).catch(() => screen.findByLabelText('Item 1 name')),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan a receipt' })).not.toBeInTheDocument();
  });

  it('fills the rows from the photo, suggests lifespans, sets the date, and saves nothing yet', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    receiptReturns(draft, bodies);
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday: 0 })),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.upload(await screen.findByLabelText('Receipt photo'), photo());

    await waitFor(() => expect(screen.getByLabelText('Item 1 name')).toHaveValue('Milk'));
    expect(bodies).toEqual([{ mediaType: 'image/jpeg', image: 'QUJD' }]);
    // The blank starting rows are replaced by the three lines.
    expect(screen.queryByLabelText('Item 4 name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item 1 quantity')).toHaveValue(2);
    expect(screen.getByLabelText('Item 1 unit')).toHaveValue('l');
    expect(screen.getByLabelText('Item 1 price')).toHaveValue(2.4);
    expect(screen.getByLabelText('Item 1 lifespan in days')).toHaveValue(5);
    expect(screen.getByLabelText('Item 1 kept in')).toHaveValue('FRIDGE');
    // Potatoes aren't kept in the fridge, so its suggestion comes from the pantry.
    expect(screen.getByLabelText('Item 2 name')).toHaveValue('Potatoes');
    expect(screen.getByLabelText('Item 2 kept in')).toHaveValue('PANTRY');
    expect(screen.getByLabelText('Item 2 lifespan in days')).not.toHaveValue(null);
    // A food it doesn't know is left for the person to fill in.
    expect(screen.getByLabelText('Item 3 name')).toHaveValue('Zorblax');
    expect(screen.getByLabelText('Item 3 lifespan in days')).toHaveValue(null);
    expect(screen.getByLabelText('Item 3 price')).toHaveValue(null);
    expect(screen.getByLabelText('Added on (for every item)')).toHaveValue('2026-09-28');
    expect(await screen.findByText('Found 3 items. Check each one before saving.')).toBeInTheDocument();
    expect(screen.getByText(/Read from a photo, so check each line/)).toBeInTheDocument();
  });

  it('sends each row’s price when the checked rows are saved', async () => {
    const user = userEvent.setup();
    receiptReturns({ purchaseDate: null, items: [{ name: 'Milk', quantity: 2, unit: 'l', price: 2.4 }] });
    let saved: { items: Record<string, unknown>[] } | undefined;
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday: 0 })),
      http.post(`${API_URL}/foods/bulk`, async ({ request }) => {
        saved = (await request.json()) as typeof saved;
        return HttpResponse.json({ items: [] }, { status: 201 });
      }),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.upload(await screen.findByLabelText('Receipt photo'), photo());
    await waitFor(() => expect(screen.getByLabelText('Item 1 name')).toHaveValue('Milk'));
    await user.click(screen.getByRole('button', { name: 'Add 1 item' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved!.items[0]).toMatchObject({ name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 5, price: 2.4 });
  });

  it('keeps rows already typed, and adds the receipt lines after them', async () => {
    const user = userEvent.setup();
    receiptReturns({ purchaseDate: null, items: [{ name: 'Milk', quantity: 1, unit: 'l', price: null }] });
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday: 0 })),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.type(await screen.findByLabelText('Item 1 name'), 'Peas');
    await user.upload(screen.getByLabelText('Receipt photo'), photo());
    await waitFor(() => expect(screen.getByLabelText('Item 2 name')).toHaveValue('Milk'));
    expect(screen.getByLabelText('Item 1 name')).toHaveValue('Peas');
  });

  it('says so when no food lines are found, and changes nothing', async () => {
    const user = userEvent.setup();
    receiptReturns({ purchaseDate: null, items: [] });
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday: 0 })),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.upload(await screen.findByLabelText('Receipt photo'), photo());
    expect(await screen.findByText(/No food lines were found on that receipt/)).toBeInTheDocument();
    expect(screen.getByLabelText('Item 1 name')).toHaveValue('');
  });

  it('shows the server’s message when the receipt cannot be read', async () => {
    const user = userEvent.setup();
    receiptReturns({ status: 503 });
    server.use(
      http.get(`${API_URL}/ai/status`, () => HttpResponse.json({ enabled: true, dailyLimit: 20, usedToday: 0 })),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.upload(await screen.findByLabelText('Receipt photo'), photo());
    expect(await screen.findByText('Couldn’t get suggestions right now. Try again later.')).toBeInTheDocument();
  });
});
