import { Star } from 'lucide-react';
import { describeError } from '../lib/errors';
import type { ActiveFoodItem, Favourite } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { CameraScreen } from '../components/CameraScreen';
import { FoodForm } from '../components/FoodForm';
import { BottomSheet, Button, Chip } from '../components/ui';
import {
  bulkCopy,
  cameraCopy,
  favouriteCopy,
  homeCopy,
  leftoverCopy,
  photoCopy,
  productPhotoCopy,
  recentCopy,
} from '../copy';
import { fieldsFor, type ScannedFields, type ScannedItem } from '../lib/scanned';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useToastStore } from '../stores/toastStore';

export function AddFoodPage() {
  const add = useFoodStore((s) => s.add);
  const addFavourite = useFoodStore((s) => s.addFavourite);
  const toast = useToastStore((s) => s.show);
  const savePhotos = useAuthStore((s) => s.user?.savePhotos ?? true);
  const navigate = useNavigate();
  // Leftovers saved from a recipe idea arrive with a name and the leftovers box ticked. So do the ones a meal
  // reminder's "Cooked it" opens, through its address (/add?leftover=1&from=Chicken%20curry).
  const [params] = useSearchParams();
  const fromReminder = params.get('leftover') === '1';
  const prefill = (useLocation().state ??
    (fromReminder
      ? { leftover: true, ...(params.get('from') && { name: leftoverCopy.name(params.get('from')!) }) }
      : undefined)) as { name?: string; leftover?: boolean } | undefined;
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [camera, setCamera] = useState(false);
  // One scanned product pre-fills the form; a new key starts the form again from it.
  const [scanned, setScanned] = useState<{ key: number; fields: ScannedFields } | null>(null);
  // The photo taken for it, kept to save with the food once the food is saved.
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [signs, setSigns] = useState<string[] | null>(null);
  const inventory = useFoodStore((s) => s.inventory);
  // The foods you added most recently (one of each name), apart from your favourites, to fill the form in a tap.
  const recents = recentFoods(inventory?.items ?? [], favourites);
  const loadLearned = useSuggestionStore((s) => s.load);

  useEffect(() => {
    let current = true;
    api.favourites().then(
      ({ items }) => current && setFavourites(items),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    void loadLearned();
  }, [loadLearned]);

  /** Back from the camera: one product fills in this form; several become a Bulk Add list. */
  function finishCamera(items: ScannedItem[]) {
    setCamera(false);
    if (items.length === 1) {
      const [item] = items as [ScannedItem];
      setScanned((previous) => ({ key: (previous?.key ?? 0) + 1, fields: fieldsFor(item) }));
      setPhoto(item.photo ?? null);
      setSigns(item.signs ?? null);
      toast(cameraCopy.foundOne(item.name));
    } else if (items.length > 1) {
      navigate('/add/bulk', { state: { scanned: items } });
    }
  }

  /** A recent food fills in the form (name, amount, unit, lifespan, place) for you to check and save. */
  function fillFrom(recent: RecentFood) {
    setScanned((previous) => ({
      key: (previous?.key ?? 0) + 1,
      fields: {
        name: recent.name,
        quantity: recent.quantity,
        unit: recent.unit,
        storage: recent.storage,
      },
    }));
    setPhoto(null);
    setSigns(null);
  }

  /** Closing the sheet goes back to where you were (or Home, if the sheet was the first screen). */
  function close() {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  }

  /** One tap re-adds a favourite, added today. */
  async function reAdd(favourite: Favourite) {
    try {
      await addFavourite(favourite.id);
      toast(favouriteCopy.addedToast(favourite.name));
    } catch (err) {
      toast(describeError(err, 'add that food again'));
    }
  }

  return (
    <>
      <BottomSheet title="Add food" onClose={close} className="sm:max-w-lg">
        <div className="space-y-5">
          {/* The camera is the first way in; typing it in yourself is just below. */}
          <section aria-label={cameraCopy.title} className="space-y-1">
            <Button className="w-full" onClick={() => setCamera(true)}>
              {cameraCopy.open}
            </Button>
            <p className="text-center text-sm text-muted">{cameraCopy.or}</p>
          </section>
          {camera && <CameraScreen onDone={finishCamera} onClose={() => setCamera(false)} />}

          {favourites.length > 0 && (
            <section aria-labelledby="favourites-heading">
              <h3 id="favourites-heading" className="text-sm font-semibold text-ink">
                {favouriteCopy.title}
              </h3>
              <p className="mb-2 text-sm text-muted">{favouriteCopy.hint}</p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {favourites.map((f) => (
                  <Chip key={f.id} aria-label={`Add ${f.name} again`} onClick={() => reAdd(f)}>
                    <Star aria-hidden className="size-4 fill-current" /> {f.name}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {recents.length > 0 && (
            <section aria-labelledby="recents-heading">
              <h3 id="recents-heading" className="text-sm font-semibold text-ink">
                {recentCopy.title}
              </h3>
              <p className="mb-2 text-sm text-muted">{recentCopy.hint}</p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {recents.map((recent) => (
                  <Chip key={recent.name} aria-label={recentCopy.fill(recent.name)} onClick={() => fillFrom(recent)}>
                    {recent.name}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {signs && (
            <div
              role="group"
              aria-label={photoCopy.signsRegion}
              className="space-y-2 rounded-card bg-soon px-4 py-3 text-soon-ink"
            >
              <p>{photoCopy.signs(signs)}</p>
              <Button variant="ghost" onClick={() => setSigns(null)}>
                {photoCopy.dismiss}
              </Button>
            </div>
          )}

          <FoodForm
            key={scanned?.key ?? 0}
            prefill={scanned?.fields ?? prefill}
            submitLabel={homeCopy.addFood}
            allowAddAnother
            autoFocus
            onSubmit={async (input, addAnother) => {
              const saved = await add(input);
              // The photo goes up once the food exists. If it can't be kept, the food is still saved.
              let kept = true;
              if (photo && savePhotos) {
                try {
                  await api.uploadFoodPhoto(saved.id, photo);
                  void useFoodStore.getState().refresh();
                } catch {
                  kept = false;
                }
              }
              setPhoto(null);
              setSigns(null);
              // One message: the toast shows a single line, so a lost photo must not be covered by "Added".
              toast(kept ? `Added ${input.name}` : productPhotoCopy.notKept);
              if (!addAnother) navigate('/');
            }}
          />

          <Link
            to="/add/bulk"
            className="flex min-h-12 items-center justify-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            {bulkCopy.link}
          </Link>
        </div>
      </BottomSheet>
    </>
  );
}

/** A food you added recently, with what it was like, to start the form from. */
export interface RecentFood {
  name: string;
  quantity: number;
  unit: ActiveFoodItem['unit'];
  lifespanDays: number;
  storage: ActiveFoodItem['storage'];
}

/** The most recently added foods, one of each name, leaving out your favourites (they have their own chips). */
export function recentFoods(items: ActiveFoodItem[], favourites: Favourite[], limit = 6): RecentFood[] {
  const skip = new Set(favourites.map((f) => f.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: RecentFood[] = [];
  for (const item of [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
    const key = item.name.trim().toLowerCase();
    if (skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      lifespanDays: item.lifespanDays,
      storage: item.storage,
    });
    if (result.length === limit) break;
  }
  return result;
}
