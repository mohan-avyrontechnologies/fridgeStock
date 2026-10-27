import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoCheck } from '@fridgestock/shared';
import { API_URL } from '../api/client';
import { item } from '../mocks/handlers';
import { server } from '../mocks/server';
import { FoodDetailPage } from '../pages/FoodDetailPage';
import { HouseholdPage } from '../pages/HouseholdPage';
import { useAiStore } from '../stores/aiStore';
import { renderSignedIn } from './render';

// The browser's canvas and image decoding aren't in the test environment; the real function is covered elsewhere.
vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/image')>()),
  photoForUpload: vi.fn(async () => ({ mediaType: 'image/jpeg' as const, image: 'QUJD', blob: new Blob(['x']) })),
}));

/** Phase 7: Photo Check. The API is faked with MSW; the AI's answers are canned. */

/** What the app is told about AI: the store is set up front, and the server answers the same if it asks again. */
const status = (enabled: boolean, photoCheck: boolean) => {
  const body = { enabled, photoCheck, dailyLimit: 20, usedToday: 0 };
  useAiStore.setState({ status: body });
  server.use(http.get(`${API_URL}/ai/status`, () => HttpResponse.json(body)));
};

beforeEach(() => status(true, true));
afterEach(() => useAiStore.setState({ status: null }));

const photo = () => new File(['x'], 'food.jpg', { type: 'image/jpeg' });

const SIGNS_SENTENCE = (descriptions: string) =>
  `Visible signs noticed: ${descriptions}. A photo can’t show everything, so check the item yourself before using it.`;

const milk: PhotoCheck = { name: 'Milk', category: 'dairy', confidence: 0.92, warningSigns: [] };
const mouldy: PhotoCheck = {
  name: 'Bread',
  category: 'bakery',
  confidence: 0.85,
  warningSigns: [
    { type: 'MOULD', description: 'green patches on the crust' },
    { type: 'DISCOLOURATION', description: 'dark spots' },
  ],
};

/** The photo requests the app made, in order. */
function answers(result: PhotoCheck | { status: number }) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`${API_URL}/parse/photo`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return 'status' in result
        ? HttpResponse.json(
            { error: { code: 'AI_UNAVAILABLE', message: 'Couldn’t get suggestions right now. Try again later.' } },
            { status: result.status },
          )
        : HttpResponse.json(result);
    }),
  );
  return bodies;
}

describe('availability: a feature flag, and AI', () => {
  it('shows no photo controls when the flag is off, even with AI on', async () => {
    status(true, false);
    server.use(http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1' }))));
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    expect(await screen.findByRole('region', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check with photo' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Food photo')).not.toBeInTheDocument();
  });

  it('shows no photo controls when AI is off', async () => {
    status(false, false);
    server.use(http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1' }))));
    renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
    expect(await screen.findByRole('region', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check with photo' })).not.toBeInTheDocument();
  });
});

describe('Photo Check on Food Details', () => {
  const renderItem = (over: Parameters<typeof item>[0] = {}) => {
    server.use(http.get(`${API_URL}/foods/p1`, () => HttpResponse.json(item({ id: 'p1', name: 'Bread', ...over }))));
    return renderSignedIn('/food/p1', <FoodDetailPage />, '/food/:id');
  };
  const calls = () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API_URL}/foods/p1/use-today`, () => {
        seen.push('use-today');
        return HttpResponse.json(
          item({ id: 'p1', name: 'Bread', expiryDate: '2026-09-29', remainingDays: 0, urgency: 'DUE' }),
        );
      }),
      http.post(`${API_URL}/foods/p1/waste`, () => {
        seen.push('waste');
        return HttpResponse.json({ food: item({ id: 'p1', status: 'WASTED' }), usageRecord: {} });
      }),
    );
    return seen;
  };

  it('sends the photo with the item’s id', async () => {
    const user = userEvent.setup();
    const bodies = answers(mouldy);
    renderItem();
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    await screen.findByRole('group', { name: 'Visible signs noticed' });
    expect(bodies).toEqual([{ mediaType: 'image/jpeg', image: 'QUJD', foodId: 'p1' }]);
  });

  it('says nothing about condition when no warning signs are found', async () => {
    const user = userEvent.setup();
    answers({ ...milk, name: 'Bread' });
    renderItem();
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    expect(await screen.findByText('Photo checked')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Visible signs noticed' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Visible signs noticed/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /\b(fine|fresh|normal|good condition|no problems?|looks good|okay)\b/i,
    );
  });

  it('shows the warning with all three options for an item that is not due yet', async () => {
    const user = userEvent.setup();
    answers(mouldy);
    renderItem({ remainingDays: 4 });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    const group = await screen.findByRole('group', { name: 'Visible signs noticed' });
    expect(within(group).getByText(SIGNS_SENTENCE('green patches on the crust; dark spots'))).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Mark as wasted' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Use today' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it.each([
    ['due today', 0],
    ['overdue', -2],
  ])('hides "Use today" for an item that is %s, so it can never move later', async (_label, remainingDays) => {
    const user = userEvent.setup();
    answers(mouldy);
    renderItem({ remainingDays, urgency: remainingDays === 0 ? 'DUE' : 'OVERDUE' });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    const group = await screen.findByRole('group', { name: 'Visible signs noticed' });
    expect(within(group).queryByRole('button', { name: 'Use today' })).not.toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Mark as wasted' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('asks first, and changes nothing until you confirm "Use today"', async () => {
    const user = userEvent.setup();
    answers(mouldy);
    const seen = calls();
    renderItem({ remainingDays: 4 });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    const group = await screen.findByRole('group', { name: 'Visible signs noticed' });
    await user.click(within(group).getByRole('button', { name: 'Use today' }));
    expect(
      within(group).getByText('Make Bread due today? Its expected expiry will change to today.'),
    ).toBeInTheDocument();
    expect(seen).toEqual([]);
    await user.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(within(group).getByRole('button', { name: 'Use today' })).toBeInTheDocument();
    expect(seen).toEqual([]);

    await user.click(within(group).getByRole('button', { name: 'Use today' }));
    await user.click(within(group).getByRole('button', { name: 'Yes, use today' }));
    await waitFor(() => expect(seen).toEqual(['use-today']));
    expect(await screen.findByText('Bread is now due today')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Visible signs noticed' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/due today|today/i).length).toBeGreaterThan(0);
  });

  it('marks the item as wasted from the warning', async () => {
    const user = userEvent.setup();
    answers(mouldy);
    const seen = calls();
    renderItem({ remainingDays: 4 });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    await user.click(
      within(await screen.findByRole('group', { name: 'Visible signs noticed' })).getByRole('button', {
        name: 'Mark as wasted',
      }),
    );
    await waitFor(() => expect(seen).toEqual(['waste']));
  });

  it('dismisses the warning without changing anything', async () => {
    const user = userEvent.setup();
    answers(mouldy);
    const seen = calls();
    renderItem({ remainingDays: 4 });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    const group = await screen.findByRole('group', { name: 'Visible signs noticed' });
    await user.click(within(group).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('group', { name: 'Visible signs noticed' })).not.toBeInTheDocument();
    expect(seen).toEqual([]);
  });

  it('shows the server’s message when "Use today" is refused', async () => {
    const user = userEvent.setup();
    answers(mouldy);
    server.use(
      http.post(`${API_URL}/foods/p1/use-today`, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'This item is already due today or overdue.' } },
          { status: 409 },
        ),
      ),
    );
    renderItem({ remainingDays: 4 });
    await user.upload(await screen.findByLabelText('Food photo'), photo());
    const group = await screen.findByRole('group', { name: 'Visible signs noticed' });
    await user.click(within(group).getByRole('button', { name: 'Use today' }));
    await user.click(within(group).getByRole('button', { name: 'Yes, use today' }));
    expect(await screen.findByText('This item is already due today or overdue.')).toBeInTheDocument();
  });
});

describe('the household activity log', () => {
  it('reads a photo check as a sentence', async () => {
    server.use(
      http.get(`${API_URL}/household`, () =>
        HttpResponse.json({ members: [{ id: 'u1', name: 'Asha Rao', isYou: true }], invites: [], maxMembers: 6 }),
      ),
      http.get(`${API_URL}/household/activity`, () =>
        HttpResponse.json({
          items: [
            { id: 'e1', type: 'PHOTO_CHECKED', actor: 'Asha Rao', foodName: 'Bread', at: '2026-09-29T10:00:00.000Z' },
          ],
          hasMore: false,
        }),
      ),
    );
    renderSignedIn('/household', <HouseholdPage />);
    expect(await screen.findByText('Asha Rao checked Bread with a photo')).toBeInTheDocument();
  });
});
