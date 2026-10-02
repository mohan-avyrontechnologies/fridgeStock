import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { Favourite, FoodItem } from '@cook-first/shared';
import { ActionSheet, useFoodActions, type SheetStep } from '../components/ActionSheet';
import { PageBody, PageHeader } from '../components/AppShell';
import { MoveSheet, OpenSheet } from '../components/EstimateSheets';
import { FoodForm } from '../components/FoodForm';
import { PhotoCheck } from '../components/PhotoCheck';
import { FoodPhoto } from '../lib/foodPhoto';
import { photoForUpload } from '../lib/image';
import { EstimateNote, UrgencyBadge } from '../components/Urgency';
import { Button, EmptyState, Spinner } from '../components/ui';
import {
  actionCopy,
  expectedExpiryLabel,
  favouriteCopy,
  leftoverCopy,
  moveCopy,
  openCopy,
  productPhotoCopy,
  storageLabel,
  historyActionLabel,
  pastExpectedExpiryNote,
  remainingText,
  screenCopy,
  urgencyCopy,
} from '../copy';
import { formatDisplay } from '@cook-first/shared';
import { formatInstant, formatMoney, formatQuantity } from '../lib/format';
import { useFoodStore } from '../stores/foodStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

export function FoodDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const update = useFoodStore((s) => s.update);
  const toast = useToastStore((s) => s.show);
  const currency = useAuthStore((s) => s.user?.currency) ?? 'USD';
  const savePhotos = useAuthStore((s) => s.user?.savePhotos ?? true);
  const photoInput = useRef<HTMLInputElement>(null);
  const [food, setFood] = useState<FoodItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const [favourite, setFavourite] = useState<Favourite | null>(null);
  const [estimate, setEstimate] = useState<'open' | 'move' | null>(null);
  const undoOpen = useFoodStore((s) => s.undoOpen);
  const run = useFoodActions();

  // Is this food already a favourite? (Matched by name, as favourites are unique by name.)
  useEffect(() => {
    if (!food) return;
    let current = true;
    api.favourites().then(
      ({ items }) =>
        current && setFavourite(items.find((f) => f.name.toLowerCase() === food.name.toLowerCase()) ?? null),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [food]);

  function finishEstimate(updated: FoodItem) {
    setEstimate(null);
    setFood(updated);
  }

  async function markNotOpened() {
    if (!food) return;
    try {
      setFood(await undoOpen(food.id));
      toast(openCopy.undone(food.name));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  /** A photo from the camera or the files, scaled in the browser; it replaces the item's photo. */
  async function changePhoto(file: File) {
    if (!food) return;
    try {
      const { blob } = await photoForUpload(file);
      setFood(await api.uploadFoodPhoto(food.id, blob));
      toast(productPhotoCopy.saved);
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : productPhotoCopy.error);
    } finally {
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  async function removePhoto() {
    if (!food) return;
    try {
      await api.removeFoodPhoto(food.id);
      setFood({ ...food, photoAt: null });
      toast(productPhotoCopy.removed);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : productPhotoCopy.error);
    }
  }

  async function toggleFavourite() {
    if (!food) return;
    try {
      if (favourite) {
        await api.removeFavourite(favourite.id);
        setFavourite(null);
        toast(favouriteCopy.removedToast(food.name));
      } else {
        const { name, quantity, unit, lifespanDays, storage } = food;
        setFavourite(await api.createFavourite({ name, quantity, unit, lifespanDays, storage }));
        toast(favouriteCopy.savedToast(food.name));
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  /** Closing actions happen at once; the toast offers "Undo". */
  async function close(action: 'USED' | 'WASTED' | 'REMOVED') {
    if (!food) return;
    try {
      await run(food, action);
      navigate('/');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  const load = useCallback(
    (isCurrent: () => boolean = () => true) =>
      api.getFood(id).then(
        (item) => isCurrent() && setFood(item),
        (err) =>
          isCurrent() &&
          setError(
            err instanceof ApiError && err.status === 404
              ? 'This item doesn’t exist or isn’t yours.'
              : 'Couldn’t load this item.',
          ),
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
                storage: food.storage,
                price: food.price,
                leftover: food.leftover,
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
              {food.photoAt && (
                <FoodPhoto
                  foodId={food.id}
                  photoAt={food.photoAt}
                  name={food.name}
                  size="full"
                  className="mb-4 aspect-[4/3] w-full rounded-xl object-cover"
                />
              )}
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
                <Detail
                  label={active ? 'Quantity left' : 'Quantity'}
                  value={formatQuantity(food.quantity, food.unit)}
                />
                <Detail label="Unit" value={food.unit} />
                <Detail label="Kept in" value={storageLabel[food.storage]} />
                {food.price !== null && <Detail label="Price" value={formatMoney(food.price, currency)} />}
                {food.leftover && <Detail label="Type" value={leftoverCopy.tag} />}
                {food.openedDate && <Detail label="Opened on" value={formatDisplay(food.openedDate)} />}
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
                  <Button onClick={() => close('USED')}>{actionCopy.USED.label}</Button>
                  <Button variant="secondary" onClick={() => setSheet('amount')}>
                    {actionCopy.PARTIALLY_USED.label}
                  </Button>
                  <Button variant="danger" onClick={() => close('WASTED')}>
                    {actionCopy.WASTED.label}
                  </Button>
                  <Button variant="secondary" onClick={() => close('REMOVED')}>
                    {actionCopy.REMOVED.label}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {food.openedDate ? (
                    <Button variant="secondary" onClick={markNotOpened}>
                      {openCopy.undo}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setEstimate('open')}>
                      {openCopy.button}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setEstimate('move')}>
                    {moveCopy.button}
                  </Button>
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={productPhotoCopy.inputLabel}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void changePhoto(file);
                  }}
                />
                {(savePhotos || food.photoAt) && (
                  <div className="grid grid-cols-2 gap-2">
                    {savePhotos && (
                      <Button variant="secondary" onClick={() => photoInput.current?.click()}>
                        {food.photoAt ? productPhotoCopy.change : productPhotoCopy.add}
                      </Button>
                    )}
                    {food.photoAt && (
                      <Button variant="secondary" onClick={removePhoto}>
                        {productPhotoCopy.remove}
                      </Button>
                    )}
                  </div>
                )}
                <PhotoCheck food={food} onWaste={() => close('WASTED')} onFoodChanged={setFood} />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button variant="ghost" aria-pressed={Boolean(favourite)} onClick={toggleFavourite}>
                    {favourite ? favouriteCopy.saved : favouriteCopy.save}
                  </Button>
                </div>
              </section>
            ) : (
              <p className="rounded-2xl bg-calm px-4 py-3 text-sm text-calm-ink">{screenCopy.detail.closedNote}</p>
            )}
            <EstimateNote />
          </>
        )}
      </PageBody>
      {food && estimate === 'open' && (
        <OpenSheet item={food} onDone={finishEstimate} onClose={() => setEstimate(null)} />
      )}
      {food && estimate === 'move' && (
        <MoveSheet item={food} onDone={finishEstimate} onClose={() => setEstimate(null)} />
      )}
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
