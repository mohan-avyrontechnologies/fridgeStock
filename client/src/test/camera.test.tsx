import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoCheck, ProductLookup } from '@fridgestock/shared';
import { API_URL } from '../api/client';
import { AppShell } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { AddFoodPage } from '../pages/AddFoodPage';
import { BulkAddPage } from '../pages/BulkAddPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAiStore } from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

// Canvas and image decoding aren't in the test environment; the real function is covered elsewhere.
vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  photoForUpload: vi.fn(async () => ({
    mediaType: 'image/jpeg' as const,
    image: 'QUJD',
    blob: new Blob(['jpeg bytes'], { type: 'image/jpeg' }),
  })),
}));

// @zxing/browser is the fallback reader; here it is a stand-in that a test can feed a barcode.
const zxing = vi.hoisted(() => ({
  callback: null as null | ((result: { getText(): string } | null) => void),
  stop: vi.fn(),
  started: 0,
}));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    async decodeFromVideoDevice(_id: unknown, _video: unknown, callback: typeof zxing.callback) {
      // Like the real reader, it asks the browser for the camera first (and fails if that is refused).
      await navigator.mediaDevices.getUserMedia({ video: true });
      zxing.started += 1;
      zxing.callback = callback;
      return { stop: zxing.stop };
    }
  },
}));
vi.mock('@zxing/library', () => ({
  BarcodeFormat: { EAN_13: 1, EAN_8: 2, UPC_A: 3 },
  DecodeHintType: { POSSIBLE_FORMATS: 4 },
}));

/** The camera screen on Add Food, photo uploads, thumbnails and the setting. The API is faked with MSW. */

const MILK_CODE = '4006381333931';
const OTHER_CODE = '5449000000996';

const milk: ProductLookup = {
  found: true,
  barcode: MILK_CODE,
  name: 'Milk',
  brand: 'Acme Dairy',
  quantity: 1000,
  unit: 'ml',
};
const zorblax: ProductLookup = {
  found: true,
  barcode: OTHER_CODE,
  name: 'Zorblax Drink',
  brand: null,
  quantity: 330,
  unit: 'ml',
};
const unknown = (code: string): ProductLookup => ({
  found: false,
  barcode: code,
  name: null,
  brand: null,
  quantity: null,
  unit: null,
});

/** Barcode look-ups the app made, with what to answer for each number. */
function products(known: ProductLookup[] = [milk, zorblax]) {
  const calls: string[] = [];
  server.use(
    http.get(`${API_URL}/products/barcode`, ({ request }) => {
      const code = new URL(request.url).searchParams.get('code') ?? '';
      calls.push(code);
      return HttpResponse.json(known.find((p) => p.barcode === code) ?? unknown(code));
    }),
  );
  return calls;
}

/** What the app is told about AI: the store is set up front and the server answers the same if it asks again. */
function status(photoCheck: boolean) {
  const body = { enabled: photoCheck, photoCheck, dailyLimit: 20, usedToday: 0 };
  useAiStore.setState({ status: body });
  server.use(http.get(`${API_URL}/ai/status`, () => HttpResponse.json(body)));
}

const photoResult = (over: Partial<PhotoCheck> = {}): PhotoCheck => ({
  name: 'Zorblax Drink',
  category: 'drinks',
  confidence: 0.9,
  warningSigns: [],
  ...over,
});

function identifies(result: PhotoCheck | PhotoCheck[]) {
  const answers = Array.isArray(result) ? [...result] : [result];
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`${API_URL}/parse/photo`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(answers.length > 1 ? answers.shift() : answers[0]);
    }),
  );
  return bodies;
}

/** Add Food and Bulk Add in one app, so a scan on one can carry over to the other. */
function renderApp(path = '/add') {
  useAuthStore.setState({
    token: 'test-token',
    user: {
      id: 'u1',
      name: 'Asha Rao',
      email: 'asha@example.com',
      timeZone: 'UTC',
      currency: 'USD',
      savePhotos: true,
      notificationPreferences: { approachingExpiry: true, due: true, overdue: true },
      reminderDelivery: { mode: 'DIGEST', hour: 8 },
    },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>Home</p>} />
          <Route path="/add" element={<AddFoodPage />} />
          <Route path="/add/bulk" element={<BulkAddPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** A pretend camera and barcode reader. */
function fakeCamera({ reads = [] as string[], detector = true } = {}) {
  const stop = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  if (detector) {
    const queue = [...reads];
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      async detect() {
        const next = queue.shift();
        return next ? [{ rawValue: next }] : [];
      }
    };
  }
  return stop;
}

const noCamera = () => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
const deniedCamera = () =>
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')) },
  });

const photoFile = () => new File(['x'], 'food.jpg', { type: 'image/jpeg' });
const openCamera = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Use the camera' }));
  return screen.getByRole('dialog', { name: 'Camera' });
};
const typeNumber = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, digits: string) => {
  const box = within(dialog).getByLabelText('Or type the number under the barcode');
  await user.clear(box);
  await user.type(box, digits);
  await user.click(within(dialog).getByRole('button', { name: 'Look up' }));
};

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test-${n++}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  zxing.callback = null;
  zxing.started = 0;
  zxing.stop.mockClear();
  status(false);
});

afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  useAiStore.setState({ status: null });
  vi.restoreAllMocks();
});

describe('the camera button on Add Food', () => {
  it('is the first option, with the manual form below it', async () => {
    renderApp();
    const button = await screen.findByRole('button', { name: 'Use the camera' });
    const form = screen.getByLabelText('Food');
    expect(button.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('or enter it yourself')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('opens the camera screen with "Scan barcode" and a way to close it', async () => {
    const user = userEvent.setup();
    noCamera();
    renderApp();
    const dialog = await openCamera(user);
    expect(within(dialog).getByRole('region', { name: 'Scan barcode' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Or type the number under the barcode')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('closes with the Escape key', async () => {
    const user = userEvent.setup();
    noCamera();
    renderApp();
    await openCamera(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('offers "Take photo" only when Photo Check is on', async () => {
    const user = userEvent.setup();
    noCamera();
    renderApp();
    const off = await openCamera(user);
    expect(within(off).queryByRole('tab', { name: 'Take photo' })).not.toBeInTheDocument();
    await user.click(within(off).getByRole('button', { name: 'Close' }));

    status(true);
    const on = await openCamera(user);
    expect(await within(on).findByRole('tab', { name: 'Take photo' })).toBeInTheDocument();
    expect(within(on).getByRole('tab', { name: 'Scan barcode' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('without a camera, or with the permission denied', () => {
  it('says so and falls back to typing the number, which still fills in Add Food', async () => {
    const user = userEvent.setup();
    deniedCamera();
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    expect(
      await within(dialog).findByText('The camera isn’t available. Type the barcode number or the name instead.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Camera view for scanning a barcode')).not.toBeInTheDocument();

    await typeNumber(user, dialog, '4006 3813-33931');
    expect(await within(dialog).findByText('Added Milk. Scan the next one, or finish below.')).toBeInTheDocument();
    expect(calls).toEqual([MILK_CODE]);
    await user.click(within(dialog).getByRole('button', { name: 'Fill in the form' }));

    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Milk'));
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toHaveValue(1000);
    expect(screen.getByLabelText('Unit')).toHaveValue('ml');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Acme Dairy');
  });

  it('says the same when the browser has no camera at all', async () => {
    const user = userEvent.setup();
    noCamera();
    renderApp();
    const dialog = await openCamera(user);
    expect(within(dialog).getByText(/The camera isn’t available/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Or type the number under the barcode')).toBeInTheDocument();
  });
});

describe('reading a barcode live', () => {
  it('uses the browser’s own detector when it has one, looks the code up and stops the camera', async () => {
    const user = userEvent.setup();
    const stop = fakeCamera({ reads: ['not a barcode', MILK_CODE] });
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    expect(await within(dialog).findByLabelText('Camera view for scanning a barcode')).toBeInTheDocument();
    expect(
      await within(dialog).findByText('Added Milk. Scan the next one, or finish below.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(calls).toEqual([MILK_CODE]);
    expect(zxing.started).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(stop).toHaveBeenCalled();
  });

  it('falls back to @zxing/browser when the browser has no detector (an iPhone, for example)', async () => {
    const user = userEvent.setup();
    fakeCamera({ detector: false });
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    await waitFor(() => expect(zxing.started).toBe(1));
    expect(within(dialog).getByLabelText('Camera view for scanning a barcode')).toBeInTheDocument();
    zxing.callback!({ getText: () => MILK_CODE });
    expect(await within(dialog).findByText('Added Milk. Scan the next one, or finish below.')).toBeInTheDocument();
    expect(calls).toEqual([MILK_CODE]);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(zxing.stop).toHaveBeenCalled();
  });

  it('looks each code up once, however many times the camera sees it', async () => {
    const user = userEvent.setup();
    fakeCamera({ detector: false });
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    await waitFor(() => expect(zxing.started).toBe(1));
    for (let i = 0; i < 5; i++) zxing.callback!({ getText: () => MILK_CODE });
    await within(dialog).findByText('Added Milk. Scan the next one, or finish below.');
    zxing.callback!({ getText: () => MILK_CODE });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toEqual([MILK_CODE]);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
  });

  it('ignores a number the camera misreads (a wrong check digit) without a message', async () => {
    const user = userEvent.setup();
    fakeCamera({ detector: false });
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    await waitFor(() => expect(zxing.started).toBe(1));
    zxing.callback!({ getText: () => '4006381333932' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toEqual([]);
    expect(within(dialog).queryByText(/Enter the 8 to 14 digits/)).not.toBeInTheDocument();
  });
});

describe('typing a barcode number', () => {
  it('checks the number before asking the server', async () => {
    const user = userEvent.setup();
    noCamera();
    const calls = products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, '4006381333932');
    expect(await within(dialog).findByText('Enter the 8 to 14 digits printed under the barcode.')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('says so when the product is not found, and when the look-up is unavailable', async () => {
    const user = userEvent.setup();
    noCamera();
    products([]);
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, MILK_CODE);
    expect(await within(dialog).findByText(/That barcode isn’t in the product list/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Scanned so far')).not.toBeInTheDocument();

    server.use(
      http.get(`${API_URL}/products/barcode`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Product lookup isn’t available right now. Type the name instead.',
            },
          },
          { status: 503 },
        ),
      ),
    );
    await typeNumber(user, dialog, MILK_CODE);
    expect(await within(dialog).findByText(/Product lookup isn’t available right now/)).toBeInTheDocument();
  });
});

describe('one product', () => {
  it('pre-fills Add Food with where the catalog keeps it, and an estimated expiry for you to confirm', async () => {
    const user = userEvent.setup();
    noCamera();
    products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, MILK_CODE); // "Milk" is in the catalog: 5 days in the fridge
    await user.click(await within(dialog).findByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Milk'));
    expect(screen.getByText(/lasts about 5 days in the fridge/)).toBeInTheDocument();
    expect(screen.getByLabelText('Kept in')).toHaveValue('FRIDGE');
    expect(screen.getByLabelText('Unit')).toHaveValue('ml'); // the pack size from the barcode keeps its own unit
  });

  it('gives a rough estimate for a food the catalog does not know', async () => {
    const user = userEvent.setup();
    noCamera();
    products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, OTHER_CODE);
    await user.click(await within(dialog).findByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Zorblax Drink'));
    expect(screen.getByText('· Rough estimate')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Notes/)).not.toBeInTheDocument();
  });
});

describe('scanning several products in a row', () => {
  it('builds a Bulk Add list, with food put where it is usually kept, ready to check', async () => {
    const user = userEvent.setup();
    noCamera();
    products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, MILK_CODE);
    await within(dialog).findByText('Added Milk. Scan the next one, or finish below.');
    await typeNumber(user, dialog, OTHER_CODE);
    await within(dialog).findByText('Added Zorblax Drink. Scan the next one, or finish below.');

    const tray = within(dialog).getByRole('region', { name: 'Scanned so far' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items together' }));

    await waitFor(() => expect(screen.getByLabelText('Item 1 name')).toHaveValue('Milk'));
    expect(screen.getByLabelText('Item 2 name')).toHaveValue('Zorblax Drink');
    expect(screen.queryByLabelText('Item 3 name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item 1 quantity')).toHaveValue(1000);
    expect(screen.getByLabelText('Item 1 unit')).toHaveValue('ml');
    expect(screen.getByLabelText('Item 1 lifespan in days')).toHaveValue(null);
    expect(screen.getByLabelText('Item 2 lifespan in days')).toHaveValue(null);
    expect(screen.getByText('Added 2 scanned items. Check each one before saving.')).toBeInTheDocument();
  });

  it('lets you take one off the list before finishing', async () => {
    const user = userEvent.setup();
    noCamera();
    products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, MILK_CODE);
    await within(dialog).findByText('Added Milk. Scan the next one, or finish below.');
    await typeNumber(user, dialog, OTHER_CODE);
    await within(dialog).findByText('Added Zorblax Drink. Scan the next one, or finish below.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Milk' }));
    expect(within(dialog).queryByText('Milk')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Fill in the form' })).toBeInTheDocument();
  });

  it('can add more from Bulk Add with "Scan more"', async () => {
    const user = userEvent.setup();
    noCamera();
    products();
    renderApp('/add/bulk');
    await user.click(await screen.findByRole('button', { name: 'Scan more' }));
    const dialog = screen.getByRole('dialog', { name: 'Camera' });
    await typeNumber(user, dialog, MILK_CODE);
    await user.click(await within(dialog).findByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Item 1 name')).toHaveValue('Milk'));
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('keeps each photo with its row and uploads them once the food is saved, in order', async () => {
    const user = userEvent.setup();
    status(true);
    noCamera();
    identifies([photoResult({ name: 'Milk' }), photoResult({ name: 'Zorblax Drink' })]);
    const order: string[] = [];
    server.use(
      http.post(`${API_URL}/foods/bulk`, () => {
        order.push('bulk');
        return HttpResponse.json(
          { items: [item({ id: 'f1', name: 'Milk' }), item({ id: 'f2', name: 'Zorblax Drink' })] },
          { status: 201 },
        );
      }),
      http.post(`${API_URL}/foods/:id/photo`, ({ params }) => {
        order.push(`photo:${params.id}`);
        return HttpResponse.json(item({ id: String(params.id) }));
      }),
    );
    renderApp();
    const dialog = await openCamera(user);
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    await within(dialog).findByText('Added Milk. Scan the next one, or finish below.');
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    await within(dialog).findByText('Added Zorblax Drink. Scan the next one, or finish below.');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items together' }));

    await waitFor(() => expect(screen.getByLabelText('Item 2 name')).toHaveValue('Zorblax Drink'));
    // A photo not saved yet (BlobThumb) shows one render after its row, once its object URL is made.
    await waitFor(() => expect(screen.getAllByRole('img', { name: /^Photo of/ })).toHaveLength(2));
    await user.type(screen.getByLabelText('Item 2 lifespan in days'), '3');
    await user.click(screen.getByRole('button', { name: 'Add 2 items' }));
    await waitFor(() => expect(order).toEqual(['bulk', 'photo:f1', 'photo:f2']));
  });
});

describe('Take photo', () => {
  const openPhotoMode = async (user: ReturnType<typeof userEvent.setup>) => {
    status(true);
    noCamera();
    renderApp();
    const dialog = await openCamera(user);
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    return dialog;
  };

  it('names the food from a photo and adds it to the list with its picture', async () => {
    const user = userEvent.setup();
    const bodies = identifies(photoResult());
    const dialog = await openPhotoMode(user);
    const input = within(dialog).getByLabelText('Food photo');
    // On a phone this opens the camera (iPhone included); on a computer it is a file chooser.
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
    await user.upload(input, photoFile());
    expect(
      await within(dialog).findByText('Added Zorblax Drink. Scan the next one, or finish below.'),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ mediaType: 'image/jpeg', image: 'QUJD' }]); // no food id: it is not at home yet
    expect(within(dialog).getByText('drinks')).toBeInTheDocument();
    // The picture (BlobThumb) shows one render after the item, once its object URL is made, so wait for it.
    expect(await within(dialog).findByRole('img', { name: 'Photo of Zorblax Drink' })).toBeInTheDocument();
  });

  it('asks you to try again when it is not sure enough (below 0.6), and adds nothing', async () => {
    const user = userEvent.setup();
    identifies(photoResult({ confidence: 0.59 }));
    const dialog = await openPhotoMode(user);
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    expect(await within(dialog).findByText(/I couldn’t tell what this is from the photo/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Scanned so far')).not.toBeInTheDocument();
  });

  it('shows visible warning signs as a note on the item, without any buttons to act on them', async () => {
    const user = userEvent.setup();
    identifies(photoResult({ warningSigns: [{ type: 'MOULD', description: 'green patches on the crust' }] }));
    const dialog = await openPhotoMode(user);
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    expect(
      await within(dialog).findByText(
        'Visible signs noticed: green patches on the crust. A photo can’t show everything, so check the item yourself before using it.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Mark as wasted' })).not.toBeInTheDocument();
  });

  it('says nothing about condition when there are no warning signs', async () => {
    const user = userEvent.setup();
    identifies(photoResult());
    const dialog = await openPhotoMode(user);
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    await within(dialog).findByText('Scanned so far');
    expect(dialog.textContent).not.toMatch(/Visible signs|\b(fine|fresh|normal|good condition|looks good|okay)\b/i);
  });

  it('shows the message from the server when the photo cannot be checked', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/parse/photo`, () =>
        HttpResponse.json(
          { error: { code: 'AI_UNAVAILABLE', message: 'Couldn’t get suggestions right now. Try again later.' } },
          { status: 503 },
        ),
      ),
    );
    const dialog = await openPhotoMode(user);
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    expect(await within(dialog).findByText('Couldn’t get suggestions right now. Try again later.')).toBeInTheDocument();
  });
});

describe('saving the photo with the food', () => {
  /** Take a photo, fill in Add Food from it, and press Save. */
  async function photographAndSave(user: ReturnType<typeof userEvent.setup>) {
    status(true);
    noCamera();
    identifies(photoResult({ name: 'Milk' }));
    renderApp();
    const dialog = await openCamera(user);
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    await user.click(await within(dialog).findByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Milk'));
    await user.click(screen.getByRole('button', { name: 'Add food' }));
  }

  it('uploads it after the food is saved, as a form field called "photo"', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    let upload: { type: string; body: string } | undefined;
    server.use(
      http.post(`${API_URL}/foods`, () => {
        seen.push('food');
        return HttpResponse.json(item({ id: 'new1', name: 'Milk' }), { status: 201 });
      }),
      http.post(`${API_URL}/foods/:id/photo`, async ({ request, params }) => {
        seen.push(`photo:${params.id}`);
        upload = { type: request.headers.get('content-type') ?? '', body: await request.text() };
        return HttpResponse.json(item({ id: 'new1', photoAt: '2026-09-29T10:00:00.000Z' }));
      }),
    );
    await photographAndSave(user);
    await waitFor(() => expect(seen).toEqual(['food', 'photo:new1']));
    expect(upload!.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(upload!.body).toContain('name="photo"');
  });

  it('still saves the food, and says so, when the photo cannot be kept', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_URL}/foods`, () => HttpResponse.json(item({ id: 'new1', name: 'Milk' }), { status: 201 })),
      http.post(`${API_URL}/foods/:id/photo`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'That photo is too large (5 MB at most).' } },
          { status: 413 },
        ),
      ),
    );
    await photographAndSave(user);
    expect(await screen.findByText('Saved, but the photo couldn’t be kept.')).toBeInTheDocument();
  });

  it('does not upload when "Save product photos" is off', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.post(`${API_URL}/foods`, () => HttpResponse.json(item({ id: 'new1', name: 'Milk' }), { status: 201 })),
      http.post(`${API_URL}/foods/:id/photo`, () => {
        seen.push('photo');
        return HttpResponse.json(item({}));
      }),
    );
    status(true);
    noCamera();
    identifies(photoResult({ name: 'Milk' }));
    renderApp();
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, savePhotos: false } });
    const dialog = await openCamera(user);
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    await user.upload(within(dialog).getByLabelText('Food photo'), photoFile());
    await user.click(await within(dialog).findByRole('button', { name: 'Fill in the form' }));
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(seen).toEqual([]);
  });

  it('uploads nothing for a food typed in by hand', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.post(`${API_URL}/foods`, () => HttpResponse.json(item({ id: 'new1' }), { status: 201 })),
      http.post(`${API_URL}/foods/:id/photo`, () => {
        seen.push('photo');
        return HttpResponse.json(item({}));
      }),
    );
    renderApp();
    await user.type(await screen.findByLabelText('Food'), 'Peas');
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
    expect(seen).toEqual([]);
  });
});

describe('photos are private: fetched with the login token and shown through object URLs', () => {
  const withPhoto = (over = {}) =>
    item({ id: 'p1', name: 'Milk', photoAt: '2026-09-29T10:00:00.000Z', urgency: 'NOT_URGENT', ...over });

  function servesPhotos() {
    const requests: { url: string; auth: string | null }[] = [];
    server.use(
      http.get(`${API_URL}/foods/:id/photo`, ({ request }) => {
        requests.push({ url: new URL(request.url).search, auth: request.headers.get('authorization') });
        return new HttpResponse(new Blob(['webp bytes'], { type: 'image/webp' }), {
          status: 200,
          headers: { 'Content-Type': 'image/webp' },
        });
      }),
    );
    return requests;
  }

  it('shows a thumbnail on a food card, fetched with the Bearer token, and revokes its URL when the card goes away', async () => {
    const requests = servesPhotos();
    const { unmount } = renderSignedIn('/x', <FoodList items={[withPhoto()]} />, '/x');
    const img = await screen.findByRole('img', { name: 'Photo of Milk' });
    expect(img).toHaveAttribute('src', created[0]);
    expect(requests).toEqual([{ url: '?size=thumb&v=2026-09-29T10%3A00%3A00.000Z', auth: 'Bearer test-token' }]);
    expect(revoked).toEqual([]);
    unmount();
    expect(revoked).toEqual([created[0]]);
  });

  it('shows no picture, and asks for none, for an item without a photo', async () => {
    const requests = servesPhotos();
    renderSignedIn('/x', <FoodList items={[item({ id: 'p2', name: 'Bread' })]} />, '/x');
    expect(await screen.findByText('Bread')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('shows nothing (and no error) when a photo cannot be loaded', async () => {
    server.use(http.get(`${API_URL}/foods/:id/photo`, () => HttpResponse.json({}, { status: 404 })));
    renderSignedIn('/x', <FoodList items={[withPhoto()]} />, '/x');
    expect(await screen.findByText('Milk')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Photo of Milk' })).not.toBeInTheDocument();
  });

  it('fetches a new picture, and releases the old one, when the photo is replaced', async () => {
    const user = userEvent.setup();
    const requests = servesPhotos();
    function Swap() {
      const [photoAt, setPhotoAt] = useState('2026-09-29T10:00:00.000Z');
      return (
        <>
          <button onClick={() => setPhotoAt('2026-09-30T10:00:00.000Z')}>New photo</button>
          <FoodList items={[withPhoto({ photoAt })]} />
        </>
      );
    }
    renderSignedIn('/x', <Swap />, '/x');
    await screen.findByRole('img', { name: 'Photo of Milk' });
    await user.click(screen.getByRole('button', { name: 'New photo' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.url).toContain('2026-09-30');
    await waitFor(() => expect(revoked).toContain(created[0]));
  });
});

describe('the photo on Food Details', () => {
  const renderDetails = (over: Record<string, unknown> = {}) => {
    server.use(
      http.get(`${API_URL}/foods/p1`, () =>
        HttpResponse.json(item({ id: 'p1', name: 'Milk', photoAt: '2026-09-29T10:00:00.000Z', ...over })),
      ),
      http.get(
        `${API_URL}/foods/:id/photo`,
        () => new HttpResponse(new Blob(['webp'], { type: 'image/webp' }), { status: 200 }),
      ),
    );
    return renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
  };

  it('shows the full photo, with Change photo and Remove photo', async () => {
    renderDetails();
    expect(await screen.findByRole('img', { name: 'Photo of Milk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  });

  it('removes the photo', async () => {
    const user = userEvent.setup();
    const removed: string[] = [];
    server.use(
      http.delete(`${API_URL}/foods/p1/photo`, () => {
        removed.push('p1');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetails();
    await screen.findByRole('img', { name: 'Photo of Milk' });
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(removed).toEqual(['p1']));
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Photo of Milk' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
  });

  it('replaces the photo with a new one', async () => {
    const user = userEvent.setup();
    let uploaded = 0;
    server.use(
      http.post(`${API_URL}/foods/p1/photo`, () => {
        uploaded += 1;
        return HttpResponse.json(item({ id: 'p1', name: 'Milk', photoAt: '2026-10-01T10:00:00.000Z' }));
      }),
    );
    renderDetails();
    await screen.findByRole('img', { name: 'Photo of Milk' });
    await user.upload(screen.getByLabelText('Product photo'), photoFile());
    await waitFor(() => expect(uploaded).toBe(1));
    expect(await screen.findByText('Photo saved')).toBeInTheDocument();
  });

  it('with the setting off, does not offer to add or change a photo, but still lets you remove one', async () => {
    useAuthStore.setState({ token: 'test-token' });
    renderDetails();
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, savePhotos: false } });
    await screen.findByRole('img', { name: 'Photo of Milk' });
    expect(screen.queryByRole('button', { name: 'Change photo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
  });
});

describe('the "Save product photos" setting', () => {
  it('is on by default, explains itself, and saves when it is switched off', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.put(`${API_URL}/auth/me`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ user: { ...useAuthStore.getState().user, savePhotos: false } });
      }),
    );
    renderSignedIn('/settings', <SettingsPage />);
    const toggle = await screen.findByRole('switch', { name: /Save product photos/ });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(
        /kept for 30 days after the item is used, wasted or removed, and deleted when you delete your account/,
      ),
    ).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(() => expect(body).toEqual({ savePhotos: false }));
    await waitFor(() => expect(useAuthStore.getState().user?.savePhotos).toBe(false));
  });
});

describe('the date step after a scan', () => {
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

  async function scanMilk(user: ReturnType<typeof userEvent.setup>) {
    noCamera();
    products();
    renderApp();
    const dialog = await openCamera(user);
    await typeNumber(user, dialog, MILK_CODE);
    await within(dialog).findByRole('region', { name: 'Show the date on the pack' });
    return dialog;
  }

  it('asks to see the date on the pack after a barcode, and skipping is always allowed', async () => {
    const user = userEvent.setup();
    const dialog = await scanMilk(user);
    await user.click(within(dialog).getByRole('button', { name: 'Skip' }));
    expect(within(dialog).queryByRole('region', { name: 'Show the date on the pack' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Milk'));
    expect(screen.queryByLabelText('Date on the pack')).not.toBeInTheDocument();
    expect(screen.getByText(/· Catalog/)).toBeInTheDocument();
  });

  it('uses a date typed as printed, with no AI at all, and sends it with the food', async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_URL}/foods`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(item({ id: 'new1' }), { status: 201 });
      }),
    );
    const dialog = await scanMilk(user);
    // Written with a month name, so it reads the same in any locale.
    const date = inDays(2);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const printed = `USE BY ${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    await user.type(within(dialog).getByLabelText('Date as printed'), printed);
    await user.click(within(dialog).getByRole('button', { name: 'Use this date' }));
    expect(await within(dialog).findByText(/Found use by/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Fill in the form' }));
    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue('Milk'));
    expect(screen.getByLabelText('Date on the pack')).toHaveValue(date);
    expect(screen.getByText(/· Printed date/)).toBeInTheDocument();
    expect(screen.getByText(/2 days left/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add food' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: 'Milk', printedDate: date, printedDateType: 'USE_BY' });
    expect(body).not.toHaveProperty('lifespanDays');
  });

  it('says so when a typed date is not a date or is out of range, and the step stays open', async () => {
    const user = userEvent.setup();
    const dialog = await scanMilk(user);
    const box = within(dialog).getByLabelText('Date as printed');
    await user.type(box, 'LOT 4471');
    await user.click(within(dialog).getByRole('button', { name: 'Use this date' }));
    expect(await within(dialog).findByText(/Couldn’t read a usable date/)).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, dmy(inDays(900)));
    await user.click(within(dialog).getByRole('button', { name: 'Use this date' }));
    expect(await within(dialog).findByText(/Couldn’t read a usable date/)).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Show the date on the pack' })).toBeInTheDocument();
  });

  it('reads a photo of the date with the AI only when the device cannot, and AI is on', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: { enabled: true, photoCheck: false, dailyLimit: 20, usedToday: 0 } });
    server.use(
      http.get(`${API_URL}/ai/status`, () =>
        HttpResponse.json({ enabled: true, photoCheck: false, dailyLimit: 20, usedToday: 0 }),
      ),
    );
    const seen: Record<string, unknown>[] = [];
    const date = inDays(3);
    server.use(
      http.post(`${API_URL}/parse/date`, async ({ request }) => {
        seen.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ text: dmy(date), printedDate: date, printedDateType: 'BEST_BEFORE' });
      }),
    );
    const dialog = await scanMilk(user);
    await user.upload(within(dialog).getByLabelText('Read the date'), photoFile());
    expect(await within(dialog).findByText(/Found best before/i)).toBeInTheDocument();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mediaType: 'image/jpeg', image: 'QUJD' });
    expect(typeof seen[0]!.locale).toBe('string');
  });

  it('never calls the AI date reader when AI is off', async () => {
    const user = userEvent.setup();
    useAiStore.setState({ status: { enabled: false, photoCheck: false, dailyLimit: 20, usedToday: 0 } });
    let called = false;
    server.use(
      http.post(`${API_URL}/parse/date`, () => {
        called = true;
        return HttpResponse.json({ text: null, printedDate: null, printedDateType: 'UNKNOWN' });
      }),
    );
    const dialog = await scanMilk(user);
    await user.upload(within(dialog).getByLabelText('Read the date'), photoFile());
    expect(await within(dialog).findByText(/Couldn’t read a usable date/)).toBeInTheDocument();
    expect(called).toBe(false);
  });
});
