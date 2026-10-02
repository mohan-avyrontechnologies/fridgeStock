import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { COLLAPSE_MS } from '../components/FoodCard';
import { PULL_THRESHOLD } from '../components/PullToRefresh';
import { SWIPE_THRESHOLD } from '../components/SwipeActions';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { CookFirstPage } from '../pages/CookFirstPage';
import { DashboardPage } from '../pages/DashboardPage';
import { platform } from '../platform';
import { useFoodStore } from '../stores/foodStore';
import { renderSignedIn } from './render';

/** Food cards: what they show, swiping, optimistic updates, skeletons, pull to refresh, haptics and the "used" animation. */

const spinach = item({
  id: 's',
  name: 'Spinach',
  urgency: 'APPROACHING_EXPIRY',
  remainingDays: 2,
  expiryDate: '2026-10-01',
});
const milk = item({
  id: 'm',
  name: 'Milk',
  quantity: 1,
  unit: 'l',
  urgency: 'NOT_URGENT',
  remainingDays: 6,
  expiryDate: '2026-10-05',
});

/** Serves these foods, and records every call to the action endpoints. */
function api(items = [spinach, milk]) {
  const calls: string[] = [];
  let list = items;
  server.use(
    http.get(`${API_URL}/foods`, () =>
      HttpResponse.json({
        today: '2026-09-29',
        summary: { NOT_URGENT: 1, APPROACHING_EXPIRY: 1, DUE: 0, OVERDUE: 0, total: list.length },
        items: list,
      }),
    ),
    http.get(`${API_URL}/foods/cook-first`, () =>
      HttpResponse.json({ today: '2026-09-29', items: list.filter((i) => i.urgency !== 'NOT_URGENT') }),
    ),
    http.post(`${API_URL}/foods/:id/use`, ({ params }) => {
      calls.push(`use ${String(params.id)}`);
      list = list.filter((i) => i.id !== params.id);
      return HttpResponse.json({ ...spinach, status: 'USED' });
    }),
    http.post(`${API_URL}/foods/:id/waste`, ({ params }) => {
      calls.push(`waste ${String(params.id)}`);
      list = list.filter((i) => i.id !== params.id);
      return HttpResponse.json({ ...spinach, status: 'WASTED' });
    }),
    http.post(`${API_URL}/foods/:id/undo`, ({ params }) => {
      calls.push(`undo ${String(params.id)}`);
      list = items;
      return HttpResponse.json(spinach);
    }),
  );
  return calls;
}

const cardFor = (name: string) => screen.getAllByRole('heading', { level: 3, name }).at(-1)!.closest('li')!;

/** Drags a card sideways with a finger. */
function swipe(element: HTMLElement, from: number, to: number, y = 0) {
  const target = element.closest('li')!.querySelector('a')!.closest('div[class*="touch-pan-y"]')!;
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', clientX: from, clientY: 100 });
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'touch', clientX: (from + to) / 2, clientY: 100 + y / 2 });
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 100 + y });
  fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'touch', clientX: to, clientY: 100 + y });
}

beforeEach(() => {
  useFoodStore.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('what a food card shows', () => {
  it('has a large name, the quantity, the days left in words and the urgency badge', async () => {
    api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    const card = within(
      await screen.findByRole('heading', { level: 3, name: 'Spinach' }).then((h) => h.closest('li')!),
    );
    expect(card.getByText('Use soon')).toBeInTheDocument();
    expect(card.getByText(/2 days left/)).toBeInTheDocument();
    expect(card.getByText(/1 l/)).toBeInTheDocument();
  });

  it('never shows a freshness meter, ring or bar: only words and the badge', async () => {
    api();
    renderSignedIn('/', <DashboardPage />);
    await screen.findAllByRole('heading', { level: 3, name: 'Spinach' });
    for (const role of ['progressbar', 'meter', 'slider', 'img']) expect(screen.queryAllByRole(role), role).toEqual([]);
    expect(document.querySelectorAll('progress, meter, svg circle[stroke-dasharray]')).toHaveLength(0);
  });

  it('shows a picture of the kind of food when there is no photo, and the photo when there is', async () => {
    api([
      { ...item({ id: 'e', name: 'Eggs' }), photoAt: null },
      { ...item({ id: 'p', name: 'Pizza' }), photoAt: '2026-09-29T10:00:00Z' },
    ]);
    server.use(
      http.get(
        `${API_URL}/foods/p/photo`,
        () => new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }),
      ),
    );
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }));
    renderSignedIn('/', <DashboardPage />);
    await screen.findAllByRole('heading', { level: 3, name: 'Eggs' });
    // The icon is decoration (hidden from screen readers): the name beside it says what the food is.
    expect(within(cardFor('Eggs')).queryByRole('img')).not.toBeInTheDocument();
    expect(await within(cardFor('Pizza')).findByRole('img', { name: 'Photo of Pizza' })).toBeInTheDocument();
  });
});

describe('swiping', () => {
  it('right marks the item as used, left as wasted, each with an Undo toast', async () => {
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 20, 20 + SWIPE_THRESHOLD + 10);
    expect(await screen.findByText('Marked as used: Spinach')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(calls).toEqual(['use s']);
  });

  it('left marks it as wasted', async () => {
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 300, 300 - SWIPE_THRESHOLD - 10);
    expect(await screen.findByText('Marked as wasted: Spinach')).toBeInTheDocument();
    expect(calls).toEqual(['waste s']);
  });

  it('Undo brings the item back', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 20, 200);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Spinach' })).toBeInTheDocument();
    expect(calls).toEqual(['use s', 'undo s']);
  });

  it('a short swipe does nothing, and the card stays', async () => {
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 20, 20 + SWIPE_THRESHOLD - 30);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
    expect(screen.getByRole('heading', { level: 3, name: 'Spinach' })).toBeInTheDocument();
  });

  it('a mostly vertical drag is a scroll, not a swipe', async () => {
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 20, 20 + SWIPE_THRESHOLD + 40, 400);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
  });

  it('the visible buttons are still there, so swiping is never required', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Wasted: Spinach' }));
    expect(await screen.findByText('Marked as wasted: Spinach')).toBeInTheDocument();
    expect(calls).toEqual(['waste s']);
  });
});

describe('optimistic updates', () => {
  it('the card is gone before the server has answered, and comes back with a message if it is refused', async () => {
    const user = userEvent.setup();
    api();
    let answer: () => void = () => {};
    server.use(
      http.post(`${API_URL}/foods/:id/waste`, async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json({ error: { code: 'SERVER', message: 'Something went wrong.' } }, { status: 500 });
      }),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Wasted: Spinach' }));
    // The server hasn't replied yet, and the card has already left.
    expect(screen.queryByRole('heading', { level: 3, name: 'Spinach' })).not.toBeInTheDocument();
    answer();
    expect(await screen.findByRole('heading', { level: 3, name: 'Spinach' })).toBeInTheDocument();
    expect(await screen.findByText(/Couldn’t mark Spinach as wasted/)).toBeInTheDocument();
  });

  it('using part of an item shows the smaller amount at once', async () => {
    const user = userEvent.setup();
    api([
      item({
        id: 'f',
        name: 'Flour',
        quantity: 500,
        unit: 'g',
        urgency: 'APPROACHING_EXPIRY',
        remainingDays: 1,
        expiryDate: '2026-09-30',
      }),
    ]);
    server.use(
      http.post(`${API_URL}/foods/:id/use`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json({});
      }),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Used: Flour' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Used some/ }));
    await user.type(screen.getByLabelText(/How much did you use/), '200');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.body.textContent).toContain('300 g'), { timeout: 300, interval: 20 });
  });
});

describe('loading', () => {
  it('shows placeholder shapes, announced once as "Loading", not a spinner', async () => {
    api();
    renderSignedIn('/', <DashboardPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await screen.findAllByRole('heading', { level: 3, name: 'Spinach' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('pull to refresh', () => {
  const touch = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { touches: type === 'touchend' ? [] : [{ clientY: y }] });
    act(() => void document.dispatchEvent(event));
  };

  it('reloads the food when pulled down far enough from the top', async () => {
    api();
    let loads = 0;
    server.use(
      http.get(`${API_URL}/foods`, () => {
        loads += 1;
        return HttpResponse.json({
          today: '2026-09-29',
          summary: { NOT_URGENT: 0, APPROACHING_EXPIRY: 1, DUE: 0, OVERDUE: 0, total: 1 },
          items: [spinach],
        });
      }),
    );
    renderSignedIn('/', <DashboardPage />);
    await screen.findAllByRole('heading', { level: 3, name: 'Spinach' });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the first loads finish
    const before = loads;
    touch('touchstart', 50);
    touch('touchmove', 50 + PULL_THRESHOLD / 0.6 + 40);
    touch('touchend', 0);
    await waitFor(() => expect(loads).toBeGreaterThan(before));
  });

  it('does nothing for a short pull', async () => {
    api();
    let loads = 0;
    server.use(
      http.get(`${API_URL}/foods`, () => {
        loads += 1;
        return HttpResponse.json({
          today: '2026-09-29',
          summary: { NOT_URGENT: 0, APPROACHING_EXPIRY: 1, DUE: 0, OVERDUE: 0, total: 1 },
          items: [spinach],
        });
      }),
    );
    renderSignedIn('/', <DashboardPage />);
    await screen.findAllByRole('heading', { level: 3, name: 'Spinach' });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the first loads finish
    const before = loads;
    touch('touchstart', 50);
    touch('touchmove', 70);
    touch('touchend', 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loads).toBe(before);
  });

  it('does not start while a dialog is open', async () => {
    const user = userEvent.setup();
    api();
    let loads = 0;
    server.use(
      http.get(`${API_URL}/foods`, () => {
        loads += 1;
        return HttpResponse.json({
          today: '2026-09-29',
          summary: { NOT_URGENT: 0, APPROACHING_EXPIRY: 1, DUE: 0, OVERDUE: 0, total: 1 },
          items: [spinach],
        });
      }),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Used: Spinach' }));
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the first loads finish
    const before = loads;
    touch('touchstart', 50);
    touch('touchmove', 300);
    touch('touchend', 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loads).toBe(before);
  });
});

describe('haptics', () => {
  it('a completed action gives a success tap, and wasting gives a warning tap', async () => {
    const user = userEvent.setup();
    const success = vi.spyOn(platform.haptics, 'success');
    const warning = vi.spyOn(platform.haptics, 'warning');
    api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    await user.click(await screen.findByRole('button', { name: 'Wasted: Spinach' }));
    await waitFor(() => expect(warning).toHaveBeenCalledTimes(1));
    expect(success).not.toHaveBeenCalled();
  });

  it('a used item gives a success tap', async () => {
    const success = vi.spyOn(platform.haptics, 'success');
    api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    swipe(await screen.findByRole('heading', { level: 3, name: 'Spinach' }), 20, 200);
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
  });
});

describe('the "used" animation', () => {
  /** A phone that has not asked for reduced motion. */
  const motionAllowed = () =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

  it('shows a short check mark, then closes the card up before marking it as used', async () => {
    motionAllowed();
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Spinach' });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    swipe(heading, 20, 200);
    // The card is closing, and nothing has been sent yet.
    expect(calls).toEqual([]);
    expect(heading.closest('li')!.className).toContain('card-collapse');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLLAPSE_MS + 10);
    });
    vi.useRealTimers();
    expect(await screen.findByText('Marked as used: Spinach')).toBeInTheDocument();
    expect(calls).toEqual(['use s']);
  });

  it('is skipped when the person prefers reduced motion: the item is marked as used at once', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const calls = api();
    renderSignedIn('/cook-first', <CookFirstPage />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Spinach' });
    swipe(heading, 20, 200);
    expect(heading.closest('li')!.className).not.toContain('card-collapse');
    expect(await screen.findByText('Marked as used: Spinach')).toBeInTheDocument();
    expect(calls).toEqual(['use s']);
  });

  it('comes back, with a message, if marking it as used fails', async () => {
    motionAllowed();
    api();
    server.use(
      http.post(`${API_URL}/foods/:id/use`, () =>
        HttpResponse.json({ error: { code: 'SERVER', message: 'No.' } }, { status: 500 }),
      ),
    );
    renderSignedIn('/cook-first', <CookFirstPage />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Spinach' });
    swipe(heading, 20, 200);
    expect(await screen.findByText(/Couldn’t mark Spinach as used/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: 'Spinach' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Spinach' }).closest('li')!.className).not.toContain(
      'card-collapse',
    );
  });
});
