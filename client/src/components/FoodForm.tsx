import {
  addDays,
  createFoodSchema,
  diffDays,
  formatDisplay,
  isValidDate,
  MESSAGES,
  searchReference,
  STORAGE_LOCATIONS,
  todayInTz,
  UNITS,
  type FoodInput,
  type ReferenceFood,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';
import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { referenceCopy, screenCopy, storageLabel } from '../copy';
import { check } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';
import { EstimateNote } from './Urgency';
import { Button, Chip, Field, FormError } from './ui';

/** Quick picks only; any whole number from 0 to 365 can be typed. */
const LIFESPAN_PICKS = [1, 2, 3, 5, 7, 14];
const NOTES_MAX = 200;

type Errors = Partial<Record<keyof FoodInput | 'form', string>>;

interface Props {
  initial?: FoodInput;
  submitLabel: string;
  /** Resolves when saved. `addAnother` is set when the secondary button was used. */
  onSubmit: (input: FoodInput, addAnother: boolean) => Promise<void>;
  allowAddAnother?: boolean;
  autoFocus?: boolean;
}

/** Empty inputs become undefined so the shared schema reports "required" rather than 0. */
const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));

/**
 * The five required fields plus optional notes. Chips cover the common cases
 * so most items need nothing typed except the name. Input is checked with the
 * same shared schema as the server, purely so errors show instantly; the
 * server re-validates everything and calculates the expiry date itself.
 */
export function FoodForm({ initial, submitLabel, onSubmit, allowAddAnother, autoFocus }: Props) {
  const timeZone = useAuthStore((s) => s.user?.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(timeZone);
  const notesId = useId();
  const unitId = useId();
  const storageId = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'pcs');
  const [addedDate, setAddedDate] = useState(initial?.addedDate ?? today);
  const [lifespan, setLifespan] = useState(initial ? String(initial.lifespanDays) : '');
  const [storage, setStorage] = useState<StorageLocation>(initial?.storage ?? 'FRIDGE');
  // The reference food the lifespan was suggested from, if the user picked one.
  const [suggestedFrom, setSuggestedFrom] = useState<ReferenceFood | null>(null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // Notes sit behind an "Add note" link unless the item already has some.
  const [showNotes, setShowNotes] = useState(Boolean(initial?.notes));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const clearError = (field: keyof Errors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  // Reference foods matching what's typed (hidden once the name is an exact match).
  const suggestions = initial
    ? []
    : searchReference(name).filter((ref) => ref.name.toLowerCase() !== name.trim().toLowerCase());

  /** Picking a reference food fills in its name, unit and suggested lifespan for the chosen location. */
  function pickReference(ref: ReferenceFood) {
    setName(ref.name);
    setUnit(ref.unit);
    const days = ref.lifespanDays[storage];
    setLifespan(days === null ? '' : String(days));
    setSuggestedFrom(ref);
    setErrors({});
  }

  function changeStorage(next: StorageLocation) {
    setStorage(next);
    // Follow the suggestion for the new location, unless the user has typed their own lifespan.
    if (suggestedFrom) {
      const days = suggestedFrom.lifespanDays[next];
      setLifespan(days === null ? '' : String(days));
    }
  }

  const suggestedDays = suggestedFrom?.lifespanDays[storage];

  const lifespanNumber = Number(lifespan);
  const previewValid =
    lifespan !== '' &&
    Number.isInteger(lifespanNumber) &&
    lifespanNumber >= 0 &&
    lifespanNumber <= 365 &&
    isValidDate(addedDate);
  const expiryDate = previewValid ? addDays(addedDate, lifespanNumber) : null;

  function validate(): FoodInput | null {
    const { data, errors: found } = check(createFoodSchema, {
      name,
      quantity: toNumber(quantity),
      unit,
      addedDate,
      lifespanDays: toNumber(lifespan),
      notes,
      storage,
    });
    const next: Errors = { ...found };
    if (!next.addedDate && isValidDate(addedDate) && addedDate > today) {
      next.addedDate = MESSAGES.addedDate;
    }
    setErrors(next);
    return Object.keys(next).length ? null : data;
  }

  async function submit(e: FormEvent, addAnother = false) {
    e.preventDefault();
    const input = validate();
    if (!input) return;
    setBusy(true);
    try {
      await onSubmit(input, addAnother);
      if (addAnother) {
        setName('');
        setQuantity('1');
        setLifespan('');
        setNotes('');
        setShowNotes(false);
        setSuggestedFrom(null);
        setErrors({});
        document.getElementById('food-name')?.focus();
      }
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setErrors({ form: err instanceof Error ? err.message : 'Could not save. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => submit(e)} className="space-y-5" noValidate>
      <FormError message={errors.form ?? null} />

      <Field
        id="food-name"
        label="Food"
        placeholder="e.g. Spinach"
        autoComplete="off"
        autoCapitalize="sentences"
        maxLength={60}
        autoFocus={autoFocus}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSuggestedFrom(null);
          clearError('name');
        }}
        error={errors.name}
      />
      {suggestions.length > 0 && (
        <div role="group" aria-label="Suggestions" className="-mx-4 -mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {suggestions.map((ref) => {
            const days = ref.lifespanDays[storage];
            return (
              <Chip key={ref.name} onClick={() => pickReference(ref)}>
                {ref.name}
                {days !== null && <span className="ml-1 text-muted">· {days}d</span>}
              </Chip>
            );
          })}
        </div>
      )}

      <div>
        <Field
          className="w-28"
          label="Quantity"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            clearError('quantity');
          }}
          error={errors.quantity}
        />
      </div>

      <div>
        <label htmlFor={unitId} className="mb-1.5 block text-sm font-medium text-ink">
          Unit
        </label>
        <select
          id={unitId}
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value as Unit);
            clearError('unit');
          }}
          aria-invalid={errors.unit ? true : undefined}
          className={`block min-h-12 w-40 rounded-xl border bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none ${
            errors.unit ? 'border-danger' : 'border-line'
          }`}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {errors.unit && <p className="mt-1.5 text-sm text-danger">{errors.unit}</p>}
      </div>

      <div>
        <label htmlFor={storageId} className="mb-1.5 block text-sm font-medium text-ink">
          Kept in
        </label>
        <select
          id={storageId}
          value={storage}
          onChange={(e) => changeStorage(e.target.value as StorageLocation)}
          className="block min-h-12 w-40 rounded-xl border border-line bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none"
        >
          {STORAGE_LOCATIONS.map((loc) => (
            <option key={loc} value={loc}>
              {storageLabel[loc]}
            </option>
          ))}
        </select>
        {errors.storage && <p className="mt-1.5 text-sm text-danger">{errors.storage}</p>}
      </div>

      <div>
        <Field
          label="Added on"
          type="date"
          max={today}
          value={addedDate}
          onChange={(e) => {
            setAddedDate(e.target.value);
            clearError('addedDate');
          }}
          error={errors.addedDate}
        />
        <div className="mt-2 flex gap-2">
          <Chip
            selected={addedDate === today}
            onClick={() => {
              setAddedDate(today);
              clearError('addedDate');
            }}
          >
            Today
          </Chip>
          <Chip
            selected={addedDate === addDays(today, -1)}
            onClick={() => {
              setAddedDate(addDays(today, -1));
              clearError('addedDate');
            }}
          >
            Yesterday
          </Chip>
        </div>
      </div>

      <div>
        <Field
          label="Lifespan (days)"
          type="number"
          inputMode="numeric"
          min="0"
          max="365"
          step="1"
          placeholder="How many days you expect it to last"
          value={lifespan}
          onChange={(e) => {
            setLifespan(e.target.value);
            setSuggestedFrom(null);
            clearError('lifespanDays');
          }}
          error={errors.lifespanDays}
          hint={
            suggestedFrom
              ? suggestedDays === null
                ? referenceCopy.notUsuallyKept(storageLabel[storage])
                : `${referenceCopy.suggested(suggestedDays!)}. ${referenceCopy.hint}`
              : screenCopy.form.lifespanHint
          }
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {LIFESPAN_PICKS.map((d) => (
            <Chip
              key={d}
              selected={lifespan === String(d)}
              onClick={() => {
                setLifespan(String(d));
                setSuggestedFrom(null);
                clearError('lifespanDays');
              }}
            >
              {d} {d === 1 ? 'day' : 'days'}
            </Chip>
          ))}
        </div>
      </div>

      {!showNotes ? (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
        >
          + {screenCopy.form.addNote}
        </button>
      ) : (
        <div>
          <label htmlFor={notesId} className="mb-1.5 block text-sm font-medium text-ink">
            Notes <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={notesId}
            rows={2}
            maxLength={NOTES_MAX}
            placeholder="e.g. Opened, top shelf"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              clearError('notes');
            }}
            aria-invalid={errors.notes ? true : undefined}
            className={`block w-full rounded-xl border bg-card px-3.5 py-3 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none ${
              errors.notes ? 'border-danger' : 'border-line'
            }`}
          />
          <p className={`mt-1.5 text-sm ${errors.notes ? 'text-danger' : 'text-muted'}`}>
            {errors.notes ?? `${notes.length}/${NOTES_MAX}`}
          </p>
        </div>
      )}

      <div aria-live="polite" className="space-y-2 rounded-2xl bg-brand-soft px-4 py-3">
        <p className="text-base font-semibold text-ink">
          {expiryDate
            ? screenCopy.form.preview(formatDisplay(expiryDate), diffDays(today, expiryDate))
            : screenCopy.form.previewEmpty}
        </p>
        <EstimateNote />
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
        {allowAddAnother && (
          <Button type="button" variant="secondary" disabled={busy} onClick={(e) => submit(e, true)}>
            Save and add another
          </Button>
        )}
      </div>
    </form>
  );
}
