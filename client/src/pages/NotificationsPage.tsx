import { useEffect } from 'react';
import { Link } from 'react-router';
import type { AppNotification, ReminderType } from '@cook-first/shared';
import { PageBody, PageHeader } from '../components/AppShell';
import { EstimateNote } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import { reminderTypeLabel, screenCopy } from '../copy';
import { formatInstant } from '../lib/format';
import { useNotificationStore } from '../stores/notificationStore';

const TYPE_DOT: Record<ReminderType, string> = {
  APPROACHING_EXPIRY: 'bg-soon-bar',
  DUE: 'bg-today-bar',
  OVERDUE: 'bg-past-bar',
};

export function NotificationsPage() {
  const { items, total, unread, loading, fetchAll, loadMore, markRead, markAllRead } = useNotificationStore();

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return (
    <>
      <PageHeader title="Reminders" subtitle={unread ? `${unread} unread` : undefined} back="/" />
      <PageBody narrow>
        {loading && items.length === 0 && <Spinner />}
        {!loading && items.length === 0 && (
          <EmptyState title="No reminders yet">
            {screenCopy.reminders.emptyBody}
          </EmptyState>
        )}
        {unread > 0 && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => markAllRead()}>
              Mark all as read
            </Button>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((n) => (
            <ReminderRow key={n.id} n={n} onOpen={() => !n.readAt && markRead(n.id)} />
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

function ReminderRow({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  return (
    <li>
      <Link
        to={`/food/${n.foodId}`}
        onClick={onOpen}
        className={`flex gap-3 rounded-2xl border px-4 py-3 ${n.readAt ? 'border-line bg-card' : 'border-brand/30 bg-brand-soft'}`}
      >
        <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TYPE_DOT[n.type]}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">
            {reminderTypeLabel[n.type]}
            {!n.readAt && <span className="sr-only"> (unread)</span>}
          </p>
          <p className="text-[15px] text-ink">{n.message}</p>
          {n.sentAt && <p className="mt-0.5 text-xs text-muted">{formatInstant(n.sentAt)}</p>}
        </div>
      </Link>
    </li>
  );
}
