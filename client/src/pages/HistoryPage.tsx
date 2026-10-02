import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { formatDisplay, type UsageAction, type UsageRecord } from '@cook-first/shared';
import { PageBody, PageHeader } from '../components/AppShell';
import { Button, EmptyState, SkeletonList, Card } from '../components/ui';
import { historyActionLabel, screenCopy } from '../copy';
import { formatQuantity } from '../lib/format';

const ACTIONS: UsageAction[] = ['USED', 'PARTIALLY_USED', 'WASTED', 'REMOVED'];
const ACTION_STYLE: Record<UsageAction, string> = {
  USED: 'bg-brand-soft text-brand',
  PARTIALLY_USED: 'bg-brand-soft text-brand',
  WASTED: 'bg-past text-past-ink',
  REMOVED: 'bg-calm text-calm-ink',
};

export function HistoryPage() {
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<UsageAction, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .usage()
      .then((page) => {
        setRecords(page.items);
        setTotal(page.total);
        setCounts(page.counts);
      })
      .catch(() => setError(screenCopy.history.loadError));
  }, []);

  async function more() {
    const page = await api.usage(records!.length);
    setRecords([...records!, ...page.items]);
  }

  return (
    <>
      <PageHeader title="History" subtitle="What you used, wasted or removed" />
      <PageBody narrow>
        {error && <EmptyState title={error} />}
        {!records && !error && <SkeletonList />}
        {counts && (
          <ul className="grid grid-cols-4 gap-2">
            {ACTIONS.map((a) => (
              <li key={a} className={`rounded-card px-2 py-3 text-center ${ACTION_STYLE[a]}`}>
                <p className="text-2xl font-bold tabular-nums">{counts[a]}</p>
                <p className="text-xs leading-tight font-semibold">{historyActionLabel[a]}</p>
              </li>
            ))}
          </ul>
        )}
        {records && records.length === 0 && (
          <EmptyState title="No history yet">Items you mark as used, wasted or removed show up here.</EmptyState>
        )}
        {records && records.length > 0 && (
          <Card as="ul" className="divide-y divide-line overflow-hidden">
            {records.map((r) => (
              <li key={r.id}>
                <Link to={`/food/${r.foodId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.foodName}</p>
                    <p className="text-sm text-muted">
                      {formatQuantity(r.quantityUsed, r.unit)}
                      {r.quantityRemaining > 0 && ` · ${formatQuantity(r.quantityRemaining, r.unit)} left`} ·{' '}
                      {formatDisplay(r.date)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTION_STYLE[r.action]}`}>
                    {historyActionLabel[r.action]}
                  </span>
                </Link>
              </li>
            ))}
          </Card>
        )}
        {records && records.length < total && (
          <Button variant="secondary" className="w-full" onClick={more}>
            {screenCopy.history.loadMore}
          </Button>
        )}
      </PageBody>
    </>
  );
}
