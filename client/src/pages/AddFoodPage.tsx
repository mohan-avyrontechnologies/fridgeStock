import type { Favourite, ProductLookup } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { FoodForm } from '../components/FoodForm';
import { Button, Chip } from '../components/ui';
import { bulkCopy, favouriteCopy, scanCopy } from '../copy';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

export function AddFoodPage() {
  const add = useFoodStore((s) => s.add);
  const addFavourite = useFoodStore((s) => s.addFavourite);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();
  // Leftovers saved from a recipe idea arrive with a name and the leftovers box ticked.
  const prefill = (useLocation().state ?? undefined) as { name?: string; leftover?: boolean } | undefined;
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [scanning, setScanning] = useState(false);
  // A scanned product pre-fills the form; a new key starts the form again from it.
  const [scanned, setScanned] = useState<{ key: number; prefill: NonNullable<typeof prefill> } | null>(null);

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

  function applyProduct(product: ProductLookup) {
    setScanned((previous) => ({
      key: (previous?.key ?? 0) + 1,
      prefill: {
        name: product.name ?? '',
        ...(product.quantity !== null && product.unit !== null && { quantity: product.quantity, unit: product.unit }),
        ...(product.brand && { notes: product.brand }),
      },
    }));
    setScanning(false);
    toast(scanCopy.found(product.name ?? ''));
  }

  /** One tap re-adds a favourite, added today. */
  async function reAdd(favourite: Favourite) {
    try {
      await addFavourite(favourite.id);
      toast(favouriteCopy.addedToast(favourite.name));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <>
      <PageHeader title="Add food" back="/" />
      <PageBody narrow>
        {favourites.length > 0 && (
          <section aria-labelledby="favourites-heading">
            <h2 id="favourites-heading" className="text-sm font-semibold text-ink">
              {favouriteCopy.title}
            </h2>
            <p className="mb-2 text-sm text-muted">{favouriteCopy.hint}</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {favourites.map((f) => (
                <Chip key={f.id} aria-label={`Add ${f.name} again`} onClick={() => reAdd(f)}>
                  ★ {f.name}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {scanning ? (
          <BarcodeScanner onFound={applyProduct} onClose={() => setScanning(false)} />
        ) : (
          <Button variant="secondary" onClick={() => setScanning(true)}>
            {scanCopy.open}
          </Button>
        )}

        <FoodForm
          key={scanned?.key ?? 0}
          prefill={scanned?.prefill ?? prefill}
          submitLabel="Save"
          allowAddAnother
          autoFocus
          onSubmit={async (input, addAnother) => {
            await add(input);
            toast(`Added ${input.name}`);
            if (!addAnother) navigate('/');
          }}
        />

        <Link
          to="/add/bulk"
          className="flex min-h-11 items-center justify-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
        >
          {bulkCopy.link}
        </Link>
      </PageBody>
    </>
  );
}
