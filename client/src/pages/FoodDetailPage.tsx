import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { FoodItem } from '@cook-first/shared';
import { ActionSheet, type SheetStep } from '../components/ActionSheet';
import { PageBody, PageHeader } from '../components/AppShell';
import { FoodForm } from '../components/FoodForm';
import { EstimateNote, UrgencyBadge } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import {
  actionCopy,
  expectedExpiryLabel,
  historyActionLabel,
  pastExpectedExpiryNote,
  remainingText,
  screenCopy,
  urgencyCopy,
} from '../copy';
import { formatDisplay } from '@cook-first/shared';
import { formatInstant, formatQuantity } from '../lib/format';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

export function FoodDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const update = useFoodStore((s) => s.update);
  const toast = useToastStore((s) => s.show);
  const [food, setFood] = useState<FoodItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<SheetStep | null>(null);

  const load = useCallback(
    (isCurrent: () => boolean = () => true) =>
      api.getFood(id).then(
        (item) => isCurrent() && setFood(item),
        (err) =>
          isCurrent() &&
          setError(err instanceof ApiError && err.status === 404 ? 'This item doesn’t exist or isn’t yours.' : 'Couldn’t load this item.'),
      ),
    [id],
  );

  // Fetch on open; ignore a late response if the user has already moved to another item.
  useEffect(() => {
    let current = true;
    void load(() => current);
    return () => {
      current = false;
    };
  }, [load]);

  if (error) {
    return (
      <>
        <PageHeader title="Food" back="/" />
        <PageBody narrow>
          <EmptyState title={error} />
        </PageBody>
      </>
    );
  }
  if (!food) {
    return (
      <>
        <PageHeader title="Food" back="/" />
        <Spinner />
      </>
    );
  }

  const active = food.status === 'ACTIVE';

  return (
    <>
      <PageHeader title={food.name} back="/" />
      <PageBody narrow>
        {editing ? (
          <>
            <FoodForm
              submitLabel="Save changes"
              initial={{
                name: food.name,
                quantity: food.quantity,
                unit: food.unit,
                addedDate: food.addedDate,
                lifespanDays: food.lifespanDays,
                notes: food.notes ?? undefined,
              }}
              onSubmit={async (input) => {
                setFood(await update(food.id, input));
                setEditing(false);
                toast(screenCopy.detail.savedToast);
              }}
            />
            <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-card p-4">
              {active && food.urgency !== null && food.remainingDays !== null ? (
                <>
                  <UrgencyBadge urgency={food.urgency} />
                  <p className="mt-2 text-2xl font-bold tracking-tight">{remainingText(food.remainingDays)}</p>
                  <p className="text-sm text-muted">{urgencyCopy[food.urgency].hint}</p>
                </>
              ) : (
                <>
                  <span className="inline-flex rounded-full bg-calm px-2.5 py-0.5 text-xs font-semibold text-calm-ink">
                    {historyActionLabel[food.status as keyof typeof historyActionLabel]}
                  </span>
                  <p className="mt-2 text-base text-muted">
                    No longer in your active food{food.closedAt ? ` since ${formatInstant(food.closedAt)}` : ''}.
                  </p>
                </>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm">
                <Detail label={active ? 'Quantity left' : 'Quantity'} value={formatQuantity(food.quantity, food.unit)} />
                <Detail label="Unit" value={food.unit} />
                <Detail label={expectedExpiryLabel} value={formatDisplay(food.expiryDate)} />
                <Detail label="Added on" value={formatDisplay(food.addedDate)} />
                <Detail label="Lifespan" value={`${food.lifespanDays} ${food.lifespanDays === 1 ? 'day' : 'days'}`} />
                {food.notes && (
                  <div className="col-span-2">
                    <dt className="text-muted">Notes</dt>
                    <dd className="whitespace-pre-line text-ink">{food.notes}</dd>
                  </div>
                )}
              </dl>
            </section>

            {food.urgency === 'OVERDUE' && (
              <p className="rounded-2xl bg-past px-4 py-3 text-sm text-past-ink">{pastExpectedExpiryNote}</p>
            )}

            {active ? (
              <section aria-label="Actions" className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => setSheet({ confirm: 'USED' })}>{actionCopy.USED.label}</Button>
                  <Button variant="secondary" onClick={() => setSheet('amount')}>
                    {actionCopy.PARTIALLY_USED.label}
                  </Button>
                  <Button variant="danger" onClick={() => setSheet({ confirm: 'WASTED' })}>
                    {actionCopy.WASTED.label}
                  </Button>
                  <Button variant="secondary" onClick={() => setSheet({ confirm: 'REMOVED' })}>
                    {actionCopy.REMOVED.label}
                  </Button>
                </div>
                <Button variant="ghost" className="w-full" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </section>
            ) : (
              <p className="rounded-2xl bg-calm px-4 py-3 text-sm text-calm-ink">{screenCopy.detail.closedNote}</p>
            )}
            <EstimateNote />
          </>
        )}
      </PageBody>
      {sheet && (
        <ActionSheet
          item={food}
          initialStep={sheet}
          onClose={(closed) => {
            setSheet(null);
            if (closed) navigate('/');
            else void load();
          }}
        />
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}
