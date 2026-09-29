import {
  addDays,
  bulkCreateSchema,
  FOOD_REFERENCE,
  MESSAGES,
  STORAGE_LOCATIONS,
  todayInTz,
  UNITS,
  type BulkCreateInput,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { EstimateNote } from '../components/Urgency';
import { Button, Chip, Field, FormError } from '../components/ui';
import { bulkCopy, referenceCopy, storageLabel } from '../copy';
import { suggestFor } from '../lib/suggestions';
import { check } from '../lib/validation';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

interface Row {
  key: number;
  name: string;
  quantity: string;
  unit: Unit;
  lifespan: string;
  storage: StorageLocation;
}

let nextKey = 0;
const emptyRow = (): Row => ({ key: nextKey++, name: '', quantity: '1', unit: 'pcs', lifespan: '', storage: 'FRIDGE' });
const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));
const isBlank = (row: Row) => !row.name.trim() && !row.lifespan.trim();

const inputClass =
  'block min-h-11 w-full rounded-xl border bg-card px-2.5 text-base text-ink focus:border-brand focus:outline-none';

/** Add a whole shopping haul at once: one row per item, sharing an added date. */
export function BulkAddPage() {
  const timeZone = useAuthStore((s) => s.user?.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(timeZone);
  const addBulk = useFoodStore((s) => s.addBulk);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();
  const listId = useId();
  const [addedDate, setAddedDate] = useState(today);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow(), emptyRow()]);
  // Errors keyed by "<row key>.<field>", plus "form" and "addedDate".
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const learned = useSuggestionStore((s) => s.learned);
  const loadLearned = useSuggestionStore((s) => s.load);

  useEffect(() => {
    void loadLearned();
  }, [loadLearned]);

  const filled = rows.filter((r) => !isBlank(r));

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // A known food (your usual first, then the reference list) suggests its unit and lifespan.
        if (patch.name !== undefined && !row.lifespan) {
          const suggestion = suggestFor(patch.name, next.storage, learned);
          if (suggestion && suggestion.days !== null)
            Object.assign(next, { unit: suggestion.unit, lifespan: String(suggestion.days) });
        }
        return next;
      }),
    );
    setErrors({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = {
      addedDate,
      items: filled.map((r) => ({
        name: r.name,
        quantity: toNumber(r.quantity),
        unit: r.unit,
        lifespanDays: toNumber(r.lifespan),
        storage: r.storage,
      })),
    };
    const { data, errors: found } = check(bulkCreateSchema, input);
    if (found) return showErrors(Object.entries(found)[0]!);
    if (addedDate > today) return showErrors(['addedDate', MESSAGES.addedDate]);

    setBusy(true);
    try {
      const items = await addBulk(data as BulkCreateInput);
      toast(bulkCopy.added(items.length));
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.field) showErrors([err.field, err.message]);
      else setErrors({ form: err instanceof Error ? err.message : 'Could not save. Try again.' });
      setBusy(false);
    }
  }

  /** "items.2.name" from the schema or the API → the matching row's field. */
  function showErrors([field, message]: [string, string]) {
    const match = /^items\.(\d+)\.(\w+)$/.exec(field);
    if (match) setErrors({ [`${filled[Number(match[1])]!.key}.${match[2]}`]: message });
    else if (field === 'items') setErrors({ form: message });
    else setErrors({ [field]: message });
  }

  return (
    <>
      <PageHeader title={bulkCopy.title} subtitle={bulkCopy.subtitle} back="/add" />
      <PageBody narrow>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <FormError message={errors.form ?? null} />

          <div>
            <Field
              label="Added on (for every item)"
              type="date"
              max={today}
              value={addedDate}
              onChange={(e) => setAddedDate(e.target.value)}
              error={errors.addedDate}
            />
            <div className="mt-2 flex gap-2">
              <Chip selected={addedDate === today} onClick={() => setAddedDate(today)}>
                Today
              </Chip>
              <Chip selected={addedDate === addDays(today, -1)} onClick={() => setAddedDate(addDays(today, -1))}>
                Yesterday
              </Chip>
            </div>
          </div>

          <datalist id={listId}>
            {[...new Set([...learned.map((l) => l.name), ...FOOD_REFERENCE.map((ref) => ref.name)])].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <ol className="space-y-3">
            {rows.map((row, i) => {
              const err = (field: string) => errors[`${row.key}.${field}`];
              const label = bulkCopy.rowLabel(i + 1);
              return (
                <li key={row.key} className="space-y-2 rounded-2xl border border-line bg-card p-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`${label} name`}
                      list={listId}
                      placeholder={`${label}: e.g. Spinach`}
                      maxLength={60}
                      value={row.name}
                      onChange={(e) => update(row.key, { name: e.target.value })}
                      className={`${inputClass} flex-1 ${err('name') ? 'border-danger' : 'border-line'}`}
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        aria-label={`${bulkCopy.removeRow}: ${label}`}
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Quantity
                      <input
                        aria-label={`${label} quantity`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={row.quantity}
                        onChange={(e) => update(row.key, { quantity: e.target.value })}
                        className={`${inputClass} ${err('quantity') ? 'border-danger' : 'border-line'}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Unit
                      <select
                        aria-label={`${label} unit`}
                        value={row.unit}
                        onChange={(e) => update(row.key, { unit: e.target.value as Unit })}
                        className={`${inputClass} border-line`}
                      >
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Lifespan (days)
                      <input
                        aria-label={`${label} lifespan in days`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="365"
                        placeholder="days"
                        value={row.lifespan}
                        onChange={(e) => update(row.key, { lifespan: e.target.value })}
                        className={`${inputClass} ${err('lifespanDays') ? 'border-danger' : 'border-line'}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Kept in
                      <select
                        aria-label={`${label} kept in`}
                        value={row.storage}
                        onChange={(e) => update(row.key, { storage: e.target.value as StorageLocation })}
                        className={`${inputClass} border-line`}
                      >
                        {STORAGE_LOCATIONS.map((loc) => (
                          <option key={loc} value={loc}>
                            {storageLabel[loc]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {['name', 'quantity', 'lifespanDays', 'unit', 'storage'].map(
                    (f) =>
                      err(f) && (
                        <p key={f} className="text-sm text-danger">
                          {err(f)}
                        </p>
                      ),
                  )}
                </li>
              );
            })}
          </ol>

          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            + {bulkCopy.addRow}
          </Button>

          <p className="text-sm text-muted">{referenceCopy.hint}</p>

          <Button type="submit" className="w-full" disabled={busy || filled.length === 0}>
            {busy ? 'Saving…' : bulkCopy.save(filled.length)}
          </Button>
          <EstimateNote />
        </form>
      </PageBody>
    </>
  );
}
