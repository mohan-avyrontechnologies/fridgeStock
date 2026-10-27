import { formatDisplay, type ActivityEvent, type Household } from '@fridgestock/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { Button, EmptyState, Field, FormError, SectionTitle, SkeletonList, Card, LoadError } from '../components/ui';
import { householdCopy as copy, emptyCopy } from '../copy';
import { formatInstant } from '../lib/format';
import { useFoodStore } from '../stores/foodStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useToastStore } from '../stores/toastStore';
import { useNavigate } from 'react-router';

const PAGE = 20;

function activityText(event: ActivityEvent): string {
  const { type, actor, foodName } = event;
  if (type === 'MEMBER_JOINED' || type === 'MEMBER_LEFT') return copy.activity[type](actor);
  return copy.activity[type](actor, foodName ?? 'food');
}

/** Who is in the household, invites, joining or leaving, and what everyone has done. */
export function HouseholdPage() {
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const loadActivity = useCallback(async () => {
    const log = await api.householdActivity(0, PAGE);
    setEvents(log.items);
    setHasMore(log.hasMore);
  }, []);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    Promise.all([api.household(), api.householdActivity(0, PAGE)]).then(
      ([h, log]) => {
        setHousehold(h);
        setEvents(log.items);
        setHasMore(log.hasMore);
      },
      () => setLoadError(true),
    );
  }, [attempt]);

  /** What each person sees changes when the household does, so refresh the other screens' data. */
  async function afterChange(h: Household) {
    setHousehold(h);
    setNewCode(null);
    await Promise.all([
      loadActivity(),
      useFoodStore.getState().refresh(),
      useNotificationStore.getState().fetchUnread(),
    ]);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFormError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.field === 'code') setCodeError(err.message);
      else setFormError(err instanceof ApiError && err.status === 409 ? err.message : copy.actionError);
    } finally {
      setBusy(false);
    }
  }

  const makeInvite = () =>
    run(async () => {
      const invite = await api.createInvite();
      setNewCode(invite.code);
      setHousehold(await api.household());
    });

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(copy.copied);
    } catch {
      toast(copy.copyFailed);
    }
  }

  const cancelInvite = (value: string) =>
    run(async () => {
      await api.cancelInvite(value);
      if (newCode === value) setNewCode(null);
      setHousehold(await api.household());
      toast(copy.inviteCancelled);
    });

  function join(e: FormEvent) {
    e.preventDefault();
    setCodeError(undefined);
    void run(async () => {
      await afterChange(await api.joinHousehold({ code }));
      setCode('');
      toast(copy.joined);
    });
  }

  const leave = () =>
    run(async () => {
      await afterChange(await api.leaveHousehold());
      setConfirmingLeave(false);
      toast(copy.left);
    });

  async function more() {
    const log = await api.householdActivity(events!.length, PAGE);
    setEvents([...events!, ...log.items]);
    setHasMore(log.hasMore);
  }

  const shared = household ? household.members.length > 1 : false;
  const full = household ? household.members.length >= household.maxMembers : false;

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} back="/settings" />
      <PageBody narrow>
        {loadError && (
          <LoadError
            title={copy.loadError}
            onRetry={() => {
              setLoadError(false);
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {!household && !loadError && <SkeletonList />}
        {household && (
          <>
            <FormError message={formError} />

            <section aria-labelledby="members">
              <SectionTitle id="members">{copy.membersTitle}</SectionTitle>
              <Card as="ul" className="divide-y divide-line overflow-hidden">
                {household.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 break-words font-semibold">{m.name}</span>
                    {m.isYou && (
                      <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">
                        {copy.you}
                      </span>
                    )}
                  </li>
                ))}
              </Card>
              <p className="mt-3 text-sm text-muted">{shared ? copy.shared : copy.alone}</p>
            </section>

            {!full && (
              <section aria-labelledby="invite">
                <SectionTitle id="invite">{copy.inviteTitle}</SectionTitle>
                <p className="mb-3 text-sm text-muted">{copy.inviteHint}</p>
                {newCode && (
                  <div className="mb-3 rounded-card bg-brand-soft p-4" role="status">
                    <p className="text-sm text-muted">{copy.newInvite}</p>
                    <p className="my-1 text-3xl font-bold tracking-widest text-ink tabular-nums">{newCode}</p>
                    <Button variant="secondary" onClick={() => copyCode(newCode)}>
                      {copy.copy}
                    </Button>
                  </div>
                )}
                <Button disabled={busy} onClick={makeInvite}>
                  {copy.inviteButton}
                </Button>
              </section>
            )}

            {household.invites.length > 0 && (
              <section aria-labelledby="open-invites">
                <SectionTitle id="open-invites">{copy.openInvites}</SectionTitle>
                <Card as="ul" className="divide-y divide-line overflow-hidden">
                  {household.invites.map((invite) => (
                    <li key={invite.code} className="flex items-center gap-3 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold tracking-wider tabular-nums">{invite.code}</p>
                        <p className="text-sm text-muted">
                          {copy.expires(formatDisplay(invite.expiresAt.slice(0, 10)))}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        aria-label={`Cancel invite ${invite.code}`}
                        disabled={busy}
                        onClick={() => cancelInvite(invite.code)}
                      >
                        {copy.cancelInvite}
                      </Button>
                    </li>
                  ))}
                </Card>
              </section>
            )}

            {!shared && (
              <section aria-labelledby="join">
                <SectionTitle id="join">{copy.joinTitle}</SectionTitle>
                <form onSubmit={join} className="space-y-3" noValidate>
                  <Field
                    label={copy.codeLabel}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="XXXX-XXXX"
                    hint={copy.joinHint}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(undefined);
                    }}
                    error={codeError}
                  />
                  <Button type="submit" variant="secondary" disabled={busy || code.trim() === ''}>
                    {busy ? copy.joining : copy.joinButton}
                  </Button>
                </form>
              </section>
            )}

            {shared && (
              <section aria-labelledby="leave">
                <SectionTitle id="leave">{copy.leaveTitle}</SectionTitle>
                <p className="mb-3 text-sm text-muted">{copy.leaveHint}</p>
                {!confirmingLeave ? (
                  <Button variant="danger" onClick={() => setConfirmingLeave(true)}>
                    {copy.leaveButton}
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="danger" disabled={busy} onClick={leave}>
                      {busy ? copy.leaving : copy.leaveConfirm}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingLeave(false)}>
                      {copy.cancel}
                    </Button>
                  </div>
                )}
              </section>
            )}

            <section aria-labelledby="activity">
              <SectionTitle id="activity">{copy.activityTitle}</SectionTitle>
              {events && events.length === 0 && (
                <EmptyState
                  title={emptyCopy.householdActivity.title}
                  action={<Button onClick={() => navigate('/add')}>{emptyCopy.householdActivity.action}</Button>}
                >
                  {emptyCopy.householdActivity.body}
                </EmptyState>
              )}
              {events && events.length > 0 && (
                <Card as="ul" className="divide-y divide-line overflow-hidden">
                  {events.map((event) => (
                    <li key={event.id} className="px-4 py-3">
                      <p className="font-medium">{activityText(event)}</p>
                      <p className="text-sm text-muted">{formatInstant(event.at)}</p>
                    </li>
                  ))}
                </Card>
              )}
              {hasMore && (
                <Button variant="secondary" className="mt-3 w-full" onClick={more}>
                  {copy.loadMore}
                </Button>
              )}
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
