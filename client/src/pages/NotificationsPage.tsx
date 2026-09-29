import type { AppNotification, ReminderType } from '@cook-first/shared';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../components/AppShell';
import { EstimateNote } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import { reminderTypeLabel, screenCopy } from '../copy';
import { formatInstant } from '../lib/format';
import { useNotificationStore } from '../stores/notificationStore';

/** The dot's colour matches the urgency; the text label beside it always names the type. */
const TYPE_DOT: Record<ReminderType, string> = {
  APPROACHING_EXPIRY: 'bg-soon-bar',
  DUE: 'bg-today-bar',
  OVERDUE: 'bg-past-bar',
};

export function NotificationsPage() {
  const { items, total, loading, openFeed, loadMore } = useNotificationStore();

  // Opening this screen is what marks reminders as read.
  useEffect(() => {
    void openFeed();
  }, [openFeed]);

  const newCount = items.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader title="Reminders" subtitle={newCount ? `${newCount} new` : undefined} back="/" />
      <PageBody narrow>
        {loading && items.length === 0 && <Spinner />}
        {!loading && items.length === 0 && <EmptyState title="No reminders yet">{screenCopy.reminders.emptyBody}</EmptyState>}
        <ul className="space-y-2">
          {items.map((n) => (
            <ReminderRow key={n.id} n={n} />
          ))}
        </ul>
        {items.length < total && (
          <Button variant="secondary" className="w-full" onClick={() => loadMore()}>
            Show older
          </Button>
        )}
        <EstimateNote />
      </PageBody>
    </>
  );
}

function ReminderRow({ n }: { n: AppNotification }) {
  const isNew = !n.readAt;
  return (
    <li>
      <Link
        to={`/food/${n.foodId}`}
        className={`flex gap-3 rounded-2xl border px-4 py-3 ${isNew ? 'border-brand/30 bg-brand-soft' : 'border-line bg-card'}`}
      >
        <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TYPE_DOT[n.type]}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">
            {reminderTypeLabel[n.type]}
            {isNew && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-px text-[10px] text-white">New</span>}
          </p>
          <p className="text-[15px] text-ink">{n.message}</p>
          {n.sentAt && <p className="mt-0.5 text-xs text-muted">{formatInstant(n.sentAt)}</p>}
        </div>
      </Link>
    </li>
  );
}
