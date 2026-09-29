import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { FoodItem } from '../api/types';
import { ActionSheet } from '../components/ActionSheet';
import { PageHeader } from '../components/AppShell';
import { FoodForm } from '../components/FoodForm';
import { EstimateNote, UrgencyBadge } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import { historyActionLabel, pastExpectedExpiryNote, remainingText, urgencyCopy } from '../copy';
import { formatDateKey, formatInstant, formatQuantity } from '../lib/dates';
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
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setFood(await api.getFood(id));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'This item doesn’t exist or isn’t yours.' : 'Couldn’t load this item.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <>
        <PageHeader title="Food" back="/" />
        <main className="px-4 pt-4">
          <EmptyState title={error} />
        </main>
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
      <main className="space-y-5 px-4 pt-4">
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
              }}
              onSubmit={async (input) => {
                setFood(await update(food.id, input));
                setEditing(false);
                toast('Saved. Expected expiry updated.');
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
                <Detail label="Expected expiry" value={formatDateKey(food.expectedExpiryDate)} />
                <Detail label="Added on" value={formatDateKey(food.addedDate)} />
                <Detail label="Lifespan" value={`${food.lifespanDays} ${food.lifespanDays === 1 ? 'day' : 'days'}`} />
              </dl>
            </section>

            {food.urgency === 'PAST_EXPECTED_EXPIRY' && (
              <p className="rounded-2xl bg-past px-4 py-3 text-sm text-past-ink">{pastExpectedExpiryNote}</p>
            )}

            {active && (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => setSheetOpen(true)}>Used / wasted…</Button>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </div>
            )}
            <EstimateNote long />
          </>
        )}
      </main>
      {sheetOpen && (
        <ActionSheet
          item={food}
          onClose={(closed) => {
            setSheetOpen(false);
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
