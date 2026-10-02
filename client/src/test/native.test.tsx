import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoCheck, ProductLookup } from '@cook-first/shared';
import { API_URL } from '../api/client';
import { App } from '../App';
import { CameraScreen } from '../components/CameraScreen';
import { PushReminders } from '../components/PushReminders';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { BulkAddPage } from '../pages/BulkAddPage';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { OPEN_PAGE_EVENT, PUSH_ACTION_DONE_EVENT, PUSH_RECEIVED_EVENT } from '../platform/events';
import { useAiStore } from '../stores/aiStore';
import { useAuthStore } from '../stores/authStore';
import { renderSignedIn } from './render';

/**
 * The screens as they behave in the Android and iOS apps: the platform is replaced by a native-looking fake,
 * so the camera, scanner and push are the system's, not the browser's.
 */

const fake = vi.hoisted(() => {
  const saved = new Map<string, string>();
  return {
    name: 'ios' as const,
    native: true,
    saved,
    storageDelay: 0,
    storage: {
      async getItem(name: string) {
        if (fake.storageDelay) await new Promise((resolve) => setTimeout(resolve, fake.storageDelay));
        return saved.get(name) ?? null;
      },
      async setItem(name: string, value: string) {
        saved.set(name, value);
      },
      async removeItem(name: string) {
        saved.delete(name);
      },
    },
    camera: { native: true, takePhoto: vi.fn() },
    barcode: { native: true, scan: vi.fn() },
    push: {
      native: true,
      support: vi.fn(),
      isAvailable: vi.fn(),
      isBlocked: vi.fn(),
      isOn: vi.fn(),
      turnOn: vi.fn(),
      turnOff: vi.fn(),
      start: vi.fn(),
    },
  };
});
vi.mock('../platform', () => ({ platform: fake }));

vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  photoForUpload: vi.fn(async () => ({
    mediaType: 'image/jpeg' as const,
    image: 'QUJD',
    blob: new Blob(['jpeg bytes'], { type: 'image/jpeg' }),
  })),
}));

const MILK_CODE = '4006381333931';
const milk: ProductLookup = { found: true, barcode: MILK_CODE, name: 'Milk', brand: null, quantity: null, unit: null };
const photoFile = () => new File(['x'], 'photo.jpeg', { type: 'image/jpeg' });

function status(photoCheck: boolean) {
  const body = { enabled: true, photoCheck, dailyLimit: 20, usedToday: 0 };
  useAiStore.setState({ status: body });
  server.use(http.get(`${API_URL}/ai/status`, () => HttpResponse.json(body)));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  fake.saved.clear();
  fake.storageDelay = 0;
  fake.barcode.scan.mockReset();
  fake.camera.takePhoto.mockReset();
  for (const method of Object.values(fake.push))
    if (typeof method === 'function') (method as ReturnType<typeof vi.fn>).mockReset();
  server.use(
    http.get(`${API_URL}/products/barcode`, () => HttpResponse.json(milk)),
    http.post(`${API_URL}/parse/photo`, () =>
      HttpResponse.json({
        name: 'Zorblax Drink',
        category: 'drinks',
        confidence: 0.9,
        warningSigns: [],
      } satisfies PhotoCheck),
    ),
  );
  status(false);
});

afterEach(() => useAiStore.setState({ status: null }));

describe('the camera screen in the app', () => {
  const open = () => {
    render(
      <MemoryRouter>
        <CameraScreen onDone={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    return screen.getByRole('dialog', { name: 'Camera' });
  };

  it('has a button for the system scanner instead of a live camera view', () => {
    const dialog = open();
    expect(within(dialog).getByRole('button', { name: 'Scan a barcode' })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Camera view for scanning a barcode')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/The camera isn’t available/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Or type the number under the barcode')).toBeInTheDocument();
  });

  it('looks up the barcode the system scanner reads, and adds the product to the list', async () => {
    const user = userEvent.setup();
    fake.barcode.scan.mockResolvedValue(MILK_CODE);
    const dialog = open();
    await user.click(within(dialog).getByRole('button', { name: 'Scan a barcode' }));
    expect(await within(dialog).findByText('Added Milk. Scan the next one, or finish below.')).toBeInTheDocument();
    expect(fake.barcode.scan).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole('button', { name: 'Fill in Add Food' })).toBeInTheDocument();
  });

  it('does nothing when the scanner is closed without a barcode', async () => {
    const user = userEvent.setup();
    fake.barcode.scan.mockResolvedValue(null);
    const dialog = open();
    await user.click(within(dialog).getByRole('button', { name: 'Scan a barcode' }));
    await waitFor(() => expect(fake.barcode.scan).toHaveBeenCalled());
    expect(within(dialog).queryByText('Scanned so far')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the camera is not available when permission is refused, and typing the number still works', async () => {
    const user = userEvent.setup();
    fake.barcode.scan.mockRejectedValue(new Error('Camera permission was refused.'));
    const dialog = open();
    await user.click(within(dialog).getByRole('button', { name: 'Scan a barcode' }));
    expect(await within(dialog).findByText(/The camera isn’t available/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Or type the number under the barcode'), MILK_CODE);
    await user.click(within(dialog).getByRole('button', { name: 'Look up' }));
    expect(await within(dialog).findByText('Added Milk. Scan the next one, or finish below.')).toBeInTheDocument();
  });

  it('takes a photo with the system camera, and names the food from it', async () => {
    const user = userEvent.setup();
    status(true);
    fake.camera.takePhoto.mockResolvedValue(photoFile());
    const dialog = open();
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    await user.click(within(dialog).getByRole('button', { name: 'Take a photo' }));
    expect(
      await within(dialog).findByText('Added Zorblax Drink. Scan the next one, or finish below.'),
    ).toBeInTheDocument();
    expect(fake.camera.takePhoto).toHaveBeenCalledOnce();
  });

  it('adds nothing when the camera is closed without a photo', async () => {
    const user = userEvent.setup();
    status(true);
    fake.camera.takePhoto.mockResolvedValue(null);
    const dialog = open();
    await user.click(await within(dialog).findByRole('tab', { name: 'Take photo' }));
    await user.click(within(dialog).getByRole('button', { name: 'Take a photo' }));
    await waitFor(() => expect(fake.camera.takePhoto).toHaveBeenCalled());
    expect(within(dialog).queryByText('Scanned so far')).not.toBeInTheDocument();
  });
});

describe('photos from the system camera on other screens', () => {
  it('Photo Check on Food Details uses the system camera', async () => {
    const user = userEvent.setup();
    status(true);
    fake.camera.takePhoto.mockResolvedValue(photoFile());
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1', name: 'Bread', remainingDays: 4 }))),
      http.post(`${API_URL}/parse/photo`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ name: 'Bread', category: 'bakery', confidence: 0.9, warningSigns: [] });
      }),
    );
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    await user.click(await screen.findByRole('button', { name: 'Check with photo' }));
    await waitFor(() => expect(bodies).toEqual([{ mediaType: 'image/jpeg', image: 'QUJD', foodId: 'p1' }]));
    expect(fake.camera.takePhoto).toHaveBeenCalledOnce();
  });

  it('Add photo on Food Details uses the system camera, and uploads the result', async () => {
    const user = userEvent.setup();
    fake.camera.takePhoto.mockResolvedValue(photoFile());
    let uploaded = 0;
    server.use(
      http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1', name: 'Bread' }))),
      http.post(`${API_URL}/foods/p1/photo`, () => {
        uploaded += 1;
        return HttpResponse.json(item({ id: 'p1', name: 'Bread', photoAt: '2026-10-01T10:00:00.000Z' }));
      }),
      http.get(`${API_URL}/foods/:id/photo`, () => new HttpResponse(new Blob(['webp']), { status: 200 })),
    );
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    await user.click(await screen.findByRole('button', { name: 'Add photo' }));
    await waitFor(() => expect(uploaded).toBe(1));
  });

  it('Scan a receipt on Bulk Add uses the system camera', async () => {
    const user = userEvent.setup();
    status(true);
    fake.camera.takePhoto.mockResolvedValue(photoFile());
    server.use(
      http.post(`${API_URL}/parse/receipt`, () =>
        HttpResponse.json({ purchaseDate: null, items: [{ name: 'Milk', quantity: 2, unit: 'l', price: null }] }),
      ),
    );
    renderSignedIn('/add/bulk', <BulkAddPage />);
    await user.click(await screen.findByRole('button', { name: 'Scan a receipt' }));
    await waitFor(() => expect(screen.getByLabelText('Item 1 name')).toHaveValue('Milk'));
    expect(fake.camera.takePhoto).toHaveBeenCalledOnce();
  });
});

describe('push reminders in Settings, in the app', () => {
  const renderPush = () => renderSignedIn('/settings', <PushReminders />);
  const serverSays = (config: { publicKey: string | null; native: boolean }) =>
    server.use(http.get(`${API_URL}/push/config`, () => HttpResponse.json(config)));

  beforeEach(() => {
    fake.push.support.mockResolvedValue('supported');
    fake.push.isAvailable.mockImplementation((config: { native: boolean }) => config.native);
    fake.push.isBlocked.mockResolvedValue(false);
    fake.push.isOn.mockResolvedValue(false);
  });

  it('turns on through the native push, passing the server’s configuration', async () => {
    const user = userEvent.setup();
    serverSays({ publicKey: null, native: true });
    fake.push.turnOn.mockResolvedValue('on');
    renderPush();
    await user.click(await screen.findByRole('button', { name: 'Turn on reminders' }));
    expect(fake.push.turnOn).toHaveBeenCalledWith({ publicKey: null, native: true });
    expect(await screen.findByRole('button', { name: 'Turn off on this device' })).toBeInTheDocument();
  });

  it('says it is not set up when the server has no Firebase', async () => {
    serverSays({ publicKey: 'WEB-KEY', native: false });
    renderPush();
    expect(await screen.findByText(/aren’t set up on this server/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders' })).not.toBeInTheDocument();
  });

  it('shows the blocked message when the person has refused notifications for the app', async () => {
    serverSays({ publicKey: null, native: true });
    fake.push.isBlocked.mockResolvedValue(true);
    renderPush();
    expect(await screen.findByText(/blocked/i)).toBeInTheDocument();
  });

  it('turns off through the native push', async () => {
    const user = userEvent.setup();
    serverSays({ publicKey: null, native: true });
    fake.push.isOn.mockResolvedValue(true);
    fake.push.turnOff.mockResolvedValue(undefined);
    renderPush();
    await user.click(await screen.findByRole('button', { name: 'Turn off on this device' }));
    expect(fake.push.turnOff).toHaveBeenCalledOnce();
  });
});

describe('the app itself', () => {
  const renderApp = (path = '/settings') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  const signIn = () =>
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

  it('waits for the saved login to be read from secure storage before deciding where to go', async () => {
    fake.saved.set('cook-first-auth', JSON.stringify({ state: { token: 'saved-jwt', user: null }, version: 0 }));
    fake.storageDelay = 60;
    const done = useAuthStore.persist.rehydrate();
    renderApp('/login');
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    await done;
    await waitFor(() => expect(useAuthStore.getState().token).toBe('saved-jwt'));
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
  });

  it('opens the page a tapped notification asks for', async () => {
    signIn();
    renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    window.dispatchEvent(new CustomEvent(OPEN_PAGE_EVENT, { detail: '/history' }));
    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
  });

  it('refreshes the reminder count when a push arrives while the app is open', async () => {
    signIn();
    let asked = 0;
    server.use(
      http.get(`${API_URL}/notifications/unread-count`, () => {
        asked += 1;
        return HttpResponse.json({ unread: 3 });
      }),
    );
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    const before = asked;
    window.dispatchEvent(new Event(PUSH_RECEIVED_EVENT));
    await waitFor(() => expect(asked).toBeGreaterThan(before));
  });

  it('says so when a notification button was handled without opening the app’s screens', async () => {
    signIn();
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    window.dispatchEvent(new CustomEvent(PUSH_ACTION_DONE_EVENT, { detail: 'USED' }));
    expect(await screen.findByText('Marked as used')).toBeInTheDocument();
    window.dispatchEvent(new CustomEvent(PUSH_ACTION_DONE_EVENT, { detail: 'SNOOZE' }));
    expect(await screen.findByText('Snoozed until tomorrow')).toBeInTheDocument();
  });
});
