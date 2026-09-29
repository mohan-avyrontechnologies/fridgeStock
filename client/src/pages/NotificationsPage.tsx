import { useEffect } from 'react';
import { Link } from 'react-router';
import type { AppNotification, ReminderType } from '../api/types';
import { PageHeader } from '../components/AppShell';
import { EstimateNote } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import { formatInstant } from '../lib/dates';
import { useNotificationStore } from '../stores/notificationStore';

const TYPE_STYLE: Record<ReminderType, { label: string; dot: string }> = {
  APPROACHING_EXPIRY: { label: 'Use soon', dot: 'bg-soon-bar' },
  DUE: { label: 'Expected expiry today', dot: 'bg-today-bar' },
  OVERDUE: { label: 'Past expected expiry', dot: 'bg-past-bar' },
};

export function NotificationsPage() {
  const { items, total, unread, loading, fetchAll, loadMore, markRead, markAllRead } = useNotificationStore();

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return (
    <>
      <PageHeader title="Reminders" subtitle={unread ? `${unread} unread` : undefined} back="/" />
      <main className="space-y-4 px-4 pt-4">
        {loading && items.length === 0 && <Spinner />}
        {!loading && items.length === 0 && (
          <EmptyState title="No reminders yet">
            You’ll get a reminder here when an item is getting close to its expected expiry, on the day, and if it passes.
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
      </main>
    </>
  );
}

function ReminderRow({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const style = TYPE_STYLE[n.type];
  return (
    <li>
      <Link
        to={`/food/${n.foodId}`}
        onClick={onOpen}
        className={`flex gap-3 rounded-2xl border px-4 py-3 ${n.readAt ? 'border-line bg-card' : 'border-brand/30 bg-brand-soft'}`}
      >
        <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${style.dot}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">
            {style.label}
            {!n.readAt && <span className="sr-only"> (unread)</span>}
          </p>
          <p className="text-[15px] text-ink">{n.message}</p>
          {n.sentAt && <p className="mt-0.5 text-xs text-muted">{formatInstant(n.sentAt)}</p>}
        </div>
      </Link>
    </li>
  );
}
