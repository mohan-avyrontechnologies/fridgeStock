import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent, Household } from '@cook-first/shared';
import { API_URL } from '../api/client';
import { server } from '../mocks/server';
import { HouseholdPage } from '../pages/HouseholdPage';
import { renderSignedIn } from './render';

/** Phase 6: shared households. The API is faked with MSW. */

const alone: Household = {
  members: [{ id: 'u1', name: 'Asha Rao', isYou: true }],
  invites: [],
  maxMembers: 6,
};
const together: Household = {
  members: [
    { id: 'u1', name: 'Asha Rao', isYou: true },
    { id: 'u2', name: 'Ben', isYou: false },
  ],
  invites: [],
  maxMembers: 6,
};

const event = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: 'e1',
  type: 'FOOD_ADDED',
  actor: 'Ben',
  foodName: 'Milk',
  at: '2026-09-29T10:00:00.000Z',
  ...over,
});

function serve(household: Household, items: ActivityEvent[] = [], hasMore = false) {
  server.use(
    http.get(`${API_URL}/household`, () => HttpResponse.json(household)),
    http.get(`${API_URL}/household/activity`, () => HttpResponse.json({ items, hasMore })),
  );
}

const renderHousehold = () => renderSignedIn('/household', <HouseholdPage />);

describe('a household of one', () => {
  it('shows just you, how to invite, and how to join; there is nothing to leave', async () => {
    serve(alone);
    renderHousehold();
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(/It’s just you/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make an invite code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave household' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
  });

  it('makes an invite code and lists it as open', async () => {
    const user = userEvent.setup();
    let invites: Household['invites'] = [];
    server.use(
      http.get(`${API_URL}/household`, () => HttpResponse.json({ ...alone, invites })),
      http.get(`${API_URL}/household/activity`, () => HttpResponse.json({ items: [], hasMore: false })),
      http.post(`${API_URL}/household/invites`, () => {
        const invite = { code: 'K7M2-QX9P', expiresAt: '2026-10-06T12:00:00.000Z', createdBy: 'Asha Rao' };
        invites = [invite];
        return HttpResponse.json(invite, { status: 201 });
      }),
    );
    renderHousehold();
    await user.click(await screen.findByRole('button', { name: 'Make an invite code' }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText('K7M2-QX9P')).toBeInTheDocument();
    const open = (await screen.findByRole('heading', { name: 'Open invites' })).closest('section')!;
    expect(within(open).getByText('K7M2-QX9P')).toBeInTheDocument();
    expect(within(open).getByText('Works once, until Tue, 6 Oct')).toBeInTheDocument();
  });

  it('copies the code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    server.use(
      http.get(`${API_URL}/household`, () => HttpResponse.json(alone)),
      http.get(`${API_URL}/household/activity`, () => HttpResponse.json({ items: [], hasMore: false })),
      http.post(`${API_URL}/household/invites`, () =>
        HttpResponse.json(
          { code: 'K7M2-QX9P', expiresAt: '2026-10-06T12:00:00.000Z', createdBy: 'Asha Rao' },
          { status: 201 },
        ),
      ),
    );
    renderHousehold();
    await user.click(await screen.findByRole('button', { name: 'Make an invite code' }));
    await user.click(await screen.findByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('K7M2-QX9P');
    expect(await screen.findByText('Code copied')).toBeInTheDocument();
  });

  it('cancels an open invite', async () => {
    const user = userEvent.setup();
    let cancelled = '';
    serve({
      ...alone,
      invites: [{ code: 'K7M2-QX9P', expiresAt: '2026-10-06T12:00:00.000Z', createdBy: 'Asha Rao' }],
    });
    server.use(
      http.delete(`${API_URL}/household/invites/:code`, ({ params }) => {
        cancelled = String(params.code);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderHousehold();
    await user.click(await screen.findByRole('button', { name: 'Cancel invite K7M2-QX9P' }));
    await waitFor(() => expect(cancelled).toBe('K7M2-QX9P'));
  });

  it('joins with a code, then shows the household and offers to leave', async () => {
    const user = userEvent.setup();
    let body: unknown;
    let joined = false;
    server.use(
      http.get(`${API_URL}/household`, () => HttpResponse.json(joined ? together : alone)),
      http.get(`${API_URL}/household/activity`, () => HttpResponse.json({ items: [], hasMore: false })),
      http.post(`${API_URL}/household/join`, async ({ request }) => {
        body = await request.json();
        joined = true;
        return HttpResponse.json(together);
      }),
    );
    renderHousehold();
    await user.type(await screen.findByLabelText('Invite code'), 'k7m2 qx9p');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Ben')).toBeInTheDocument();
    expect(body).toEqual({ code: 'k7m2 qx9p' });
    expect(screen.getByRole('button', { name: 'Leave household' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.getByText(/Everyone here sees the same food/)).toBeInTheDocument();
  });

  it('shows the server’s message under the code field when it is not accepted', async () => {
    const user = userEvent.setup();
    serve(alone);
    server.use(
      http.post(`${API_URL}/household/join`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'That invite code isn’t valid, or it is out of date.',
              field: 'code',
            },
          },
          { status: 400 },
        ),
      ),
    );
    renderHousehold();
    await user.type(await screen.findByLabelText('Invite code'), 'ZZZZ-ZZZZ');
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('That invite code isn’t valid, or it is out of date.')).toBeInTheDocument();
  });

  it('keeps Join disabled until a code is typed', async () => {
    serve(alone);
    renderHousehold();
    expect(await screen.findByRole('button', { name: 'Join' })).toBeDisabled();
  });
});

describe('a shared household', () => {
  it('lists everyone, hides Join, and asks before leaving', async () => {
    const user = userEvent.setup();
    let left = false;
    server.use(
      http.get(`${API_URL}/household`, () => HttpResponse.json(left ? alone : together)),
      http.get(`${API_URL}/household/activity`, () => HttpResponse.json({ items: [], hasMore: false })),
      http.post(`${API_URL}/household/leave`, () => {
        left = true;
        return HttpResponse.json(alone);
      }),
    );
    renderHousehold();
    expect(await screen.findByText('Ben')).toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave household' }));
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave household' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByText(/It’s just you/)).toBeInTheDocument();
    expect(left).toBe(true);
  });

  it('hides the invite button when the household is full', async () => {
    serve({
      members: Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, isYou: i === 0 })),
      invites: [],
      maxMembers: 6,
    });
    renderHousehold();
    expect(await screen.findByText('Person 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make an invite code' })).not.toBeInTheDocument();
  });

  it('reads the activity log as sentences, and loads more', async () => {
    const user = userEvent.setup();
    const first = [
      event({ id: 'a', type: 'FOOD_ADDED', actor: 'Ben', foodName: 'Milk' }),
      event({ id: 'b', type: 'WASTED', actor: 'Asha Rao', foodName: 'Bread' }),
      event({ id: 'c', type: 'PARTIALLY_USED', actor: 'Ben', foodName: 'Rice' }),
      event({ id: 'd', type: 'MEMBER_JOINED', actor: 'Ben', foodName: null }),
    ];
    server.use(
      http.get(`${API_URL}/household`, () => HttpResponse.json(together)),
      http.get(`${API_URL}/household/activity`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        return offset === 0
          ? HttpResponse.json({ items: first, hasMore: true })
          : HttpResponse.json({
              items: [event({ id: 'e', type: 'MEMBER_LEFT', actor: 'A former member', foodName: null })],
              hasMore: false,
            });
      }),
    );
    renderHousehold();
    expect(await screen.findByText('Ben added Milk')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao wasted Bread')).toBeInTheDocument();
    expect(screen.getByText('Ben used some Rice')).toBeInTheDocument();
    expect(screen.getByText('Ben joined the household')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('A former member left the household')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an error when the household cannot be loaded', async () => {
    server.use(http.get(`${API_URL}/household`, () => HttpResponse.json({}, { status: 500 })));
    renderHousehold();
    expect(await screen.findByText(/Couldn’t load your household/)).toBeInTheDocument();
  });
});
