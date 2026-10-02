import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductLookup, ReceiptDraft } from '@cook-first/shared';
import { API_URL } from '../api/client';
import { scaledSize } from '../lib/image';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { BulkAddPage } from '../pages/BulkAddPage';
import { useAiStore } from '../stores/aiStore';
import { renderSignedIn } from './render';

// The browser's canvas and image decoding aren't in the test environment; the real function is tested below.
vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  photoForUpload: vi.fn(async () => ({ mediaType: 'image/jpeg' as const, image: 'QUJD' })),
}));

/** Phase 6: barcode and receipt scanning. The API is faked with MSW. */

const EAN = '4006381333931';

const milk: ProductLookup = {
  found: true,
  barcode: EAN,
  name: 'Whole milk',
  brand: 'Acme Dairy',
  quantity: 1000,
  unit: 'ml',
};

const lookupReturns = (product: ProductLookup | { status: number }, calls: string[] = []) =>
  server.use(
    http.get(`${API_URL}/products/barcode`, ({ request }) => {
      calls.push(new URL(request.url).searchParams.get('code') ?? '');
      return 'status' in product
        ? HttpResponse.json(
            {
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Product lookup isn’t available right now. Type the name instead.',
              },
            },
            { status: product.status },
          )
        : HttpResponse.json(product);
    }),
  );

const openScanner = async (user: ReturnType<typeof userEvent.setup>) => {
  renderSignedIn('/add', <AddFoodPage />);
  await user.click(screen.getByRole('button', { name: 'Scan a barcode' }));
};

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.restoreAllMocks();
});

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

describe('scanning a barcode on Add Food', () => {
  it('opens a panel with a number box, and no camera button when the browser cannot read barcodes', async () => {
    const user = userEvent.setup();
    await openScanner(user);
    const panel = screen.getByRole('region', { name: 'Scan a barcode' });
    expect(within(panel).getByLabelText('Or type the number under the barcode')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Use the camera' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Look up' })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Scan a barcode' })).not.toBeInTheDocument();
  });

  it('checks the number before asking the server', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    lookupReturns(milk, calls);
    await openScanner(user);
    await user.type(screen.getByLabelText('Or type the number under the barcode'), '4006381333932');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Enter the 8 to 14 digits printed under the barcode.')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('fills in the form from a product it finds, and closes the panel', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    lookupReturns(milk, calls);
    await openScanner(user);
    await user.type(screen.getByLabelText('Or type the number under the barcode'), '4006 3813-33931');
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Whole milk'));
    expect(calls).toEqual([EAN]);
    expect(screen.getByLabelText('Quantity')).toHaveValue(1000);
    expect(screen.getByLabelText('Unit')).toHaveValue('ml');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Acme Dairy');
    expect(screen.queryByRole('region', { name: 'Scan a barcode' })).not.toBeInTheDocument();
    expect(await screen.findByText(/Found: Whole milk\. Check the details/)).toBeInTheDocument();
    // Still a normal form: how long it lasts is left to the person.
    expect(screen.getByLabelText('Lifespan (days)')).toHaveValue(null);
  });

  it('leaves quantity and unit alone when the product has no pack size', async () => {
    const user = userEvent.setup();
    lookupReturns({ ...milk, quantity: null, unit: null, brand: null });
    await openScanner(user);
    await user.type(screen.getByLabelText('Or type the number under the barcode'), EAN);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Whole milk'));
    expect(screen.getByLabelText('Quantity')).toHaveValue(1);
    expect(screen.getByLabelText('Unit')).toHaveValue('pcs');
    expect(screen.queryByLabelText(/Notes/)).not.toBeInTheDocument();
  });

  it('says so when the product is not found, and keeps the panel open', async () => {
    const user = userEvent.setup();
    lookupReturns({ found: false, barcode: EAN, name: null, brand: null, quantity: null, unit: null });
    await openScanner(user);
    await user.type(screen.getByLabelText('Or type the number under the barcode'), EAN);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(
      await screen.findByText('That barcode isn’t in the product list. Type the name instead.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Food')).toHaveValue('');
  });

  it('shows the server’s message when the look-up is unavailable', async () => {
    const user = userEvent.setup();
    lookupReturns({ status: 503 });
    await openScanner(user);
    await user.type(screen.getByLabelText('Or type the number under the barcode'), EAN);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/Product lookup isn’t available right now/)).toBeInTheDocument();
  });

  describe('with a camera', () => {
    function fakeCamera(codes: string[]) {
      const stop = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
      });
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
      const queue = [...codes];
      (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
        async detect() {
          const next = queue.shift();
          return next ? [{ rawValue: next }] : [];
        }
      };
      return stop;
    }

    it('offers the camera, reads a barcode from it, looks it up and stops the camera', async () => {
      const user = userEvent.setup();
      const stop = fakeCamera(['not a barcode', EAN]);
      const calls: string[] = [];
      lookupReturns(milk, calls);
      await openScanner(user);
      await user.click(screen.getByRole('button', { name: 'Use the camera' }));
      expect(screen.getByLabelText('Camera view for scanning a barcode')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Whole milk'), { timeout: 3000 });
      expect(calls).toEqual([EAN]);
      expect(stop).toHaveBeenCalled();
    });

    it('falls back to typing when the camera cannot be opened', async () => {
      const user = userEvent.setup();
      fakeCamera([]);
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
      await openScanner(user);
      await user.click(screen.getByRole('button', { name: 'Use the camera' }));
      expect(await screen.findByText(/The camera isn’t available/)).toBeInTheDocument();
      expect(screen.getByLabelText('Or type the number under the barcode')).toBeInTheDocument();
      expect(screen.queryByLabelText('Camera view for scanning a barcode')).not.toBeInTheDocument();
    });
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
