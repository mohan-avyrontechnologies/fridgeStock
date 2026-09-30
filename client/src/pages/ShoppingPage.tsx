import { UNITS, formatDisplay, shoppingItemSchema, type ShoppingItem, type Unit } from '@cook-first/shared';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { Button, Checkbox, EmptyState, Field, Spinner } from '../components/ui';
import { shoppingCopy as copy } from '../copy';
import { formatQuantity } from '../lib/format';
import { check } from '../lib/validation';
import { useToastStore } from '../stores/toastStore';

/** The shopping list, warning about anything already at home. */
export function ShoppingPage() {
  const toast = useToastStore((s) => s.show);
  const unitId = useId();
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<Unit | ''>('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.shopping()).items);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    let current = true;
    api.shopping().then(
      ({ items }) => current && setItems(items),
      () => current && setLoadError(true),
    );
    return () => {
      current = false;
    };
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const { data, errors } = check(shoppingItemSchema, {
      name,
      quantity: quantity.trim() === '' ? null : Number(quantity),
      unit: unit || null,
    });
    if (!data) return setNameError(errors.name ?? errors.quantity);
    setBusy(true);
    try {
      const item = await api.addShopping(data);
      toast(item.atHome.length ? copy.addedWithWarning(item.name) : copy.added(item.name));
      setName('');
      setQuantity('');
      setUnit('');
      await load();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function change(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
    } catch {
      toast('Couldn’t save that. Try again.');
      await load();
    }
  }

  /** Ticks straight away, then saves; a failed save puts it back. */
  async function toggle(item: ShoppingItem) {
    setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, checked: !item.checked } : i)) ?? null);
    await change(() => api.updateShopping(item.id, { checked: !item.checked }));
  }

  const toBuy = items?.filter((item) => !item.checked) ?? [];
  const bought = items?.filter((item) => item.checked) ?? [];

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <PageBody narrow>
        <form onSubmit={add} noValidate className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <Field
            label={copy.nameLabel}
            placeholder={copy.namePlaceholder}
            maxLength={60}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(undefined);
            }}
            error={nameError}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={copy.quantityLabel}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <div>
              <label htmlFor={unitId} className="mb-1.5 block text-sm font-medium text-ink">
                {copy.unitLabel}
              </label>
              <select
                id={unitId}
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit | '')}
                className="block min-h-12 w-full rounded-xl border border-line bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none"
              >
                <option value="">{copy.noUnit}</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {copy.add}
          </Button>
        </form>

        {!items && !loadError && <Spinner />}
        {loadError && !items && <EmptyState title={copy.loadError} />}
        {items && items.length === 0 && <EmptyState title={copy.empty} />}

        {toBuy.length > 0 && (
          <section aria-labelledby="to-buy">
            <h2 id="to-buy" className="mb-2 text-lg font-semibold">
              {copy.toBuy}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
              {toBuy.map((item) => (
                <Row key={item.id} item={item} change={change} toggle={toggle} />
              ))}
            </ul>
          </section>
        )}

        {bought.length > 0 && (
          <section aria-labelledby="bought">
            <h2 id="bought" className="mb-2 text-lg font-semibold">
              {copy.bought}
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
              {bought.map((item) => (
                <Row key={item.id} item={item} change={change} toggle={toggle} />
              ))}
            </ul>
            <Button variant="secondary" className="mt-3 w-full" onClick={() => change(api.clearCheckedShopping)}>
              {copy.clear}
            </Button>
          </section>
        )}
      </PageBody>
    </>
  );
}

function Row({
  item,
  change,
  toggle,
}: {
  item: ShoppingItem;
  change: (action: () => Promise<unknown>) => Promise<void>;
  toggle: (item: ShoppingItem) => Promise<void>;
}) {
  return (
    <li className="flex items-start gap-2 py-1.5 pr-4 pl-1.5">
      <Checkbox aria-label={copy.tick(item.name)} checked={item.checked} onChange={() => toggle(item)} />
      <div className="min-w-0 flex-1 pt-2.5">
        <p className={`font-medium ${item.checked ? 'text-muted line-through' : ''}`}>
          {item.name}
          {item.quantity !== null && (
            <span className="ml-1 font-normal text-muted">· {formatQuantity(item.quantity, item.unit ?? '')}</span>
          )}
        </p>
        {!item.checked &&
          item.atHome.map((match) => (
            <p key={match.id} className="mt-1 rounded-lg bg-soon text-sm text-soon-ink">
              <Link
                to={`/food/${match.id}`}
                className="flex min-h-11 items-center px-2.5 py-1.5 underline-offset-2 hover:underline"
              >
                {copy.atHome(match.name, formatQuantity(match.quantity, match.unit), formatDisplay(match.expiryDate))}
              </Link>
            </p>
          ))}
      </div>
      <button
        type="button"
        aria-label={copy.remove(item.name)}
        className="-mr-2 mt-0.5 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink"
        onClick={() => change(() => api.removeShopping(item.id))}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
