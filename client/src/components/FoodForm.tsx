import { Minus, Plus, Star } from 'lucide-react';
import { describeError } from '../lib/errors';
import {
  addDays,
  createFoodSchema,
  diffDays,
  estimateExpiry,
  expirySourceLabel,
  findReference,
  formatDisplay,
  isUsablePrintedDate,
  isValidDate,
  LEFTOVER_MAX_DAYS,
  MESSAGES,
  PRINTED_DATE_TYPES,
  STORAGE_LOCATIONS,
  todayInTz,
  UNITS,
  usualStorage,
  type ExpirySource,
  type FoodInput,
  type PrintedDateType,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { expiryCopy, leftoverCopy, screenCopy, storageLabel } from '../copy';
import { searchSuggestions, type LifespanSuggestion } from '../lib/suggestions';
import { check } from '../lib/validation';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useAuthStore } from '../stores/authStore';
import { EstimateNote } from './Urgency';
import { Button, Checkbox, Chip, Field, FormError } from './ui';

/** Quick picks only; any whole number from 0 to 365 can be typed. */
const LIFESPAN_PICKS = [1, 2, 3, 5, 7, 14];
const NOTES_MAX = 200;

type Errors = Partial<Record<keyof FoodInput | 'form', string>>;

interface Props {
  initial?: FoodInput;
  /** Starting values for a new item, e.g. leftovers saved from a recipe idea. */
  prefill?: {
    name?: string;
    leftover?: boolean;
    quantity?: number;
    unit?: Unit;
    notes?: string;
    storage?: StorageLocation;
    /** The date to count from: the receipt's date for an item that came from a receipt. Defaults to today. */
    addedDate?: string;
    /** A free-text category (a photo's), used to estimate a food the catalog doesn't list. */
    category?: string;
    /** A date read off the pack by the camera step. */
    printedDate?: string | null;
    printedDateType?: PrintedDateType | null;
  };
  /** When editing: the expected expiry the item has now, and where it came from. */
  current?: { expiryDate: string; expirySource: ExpirySource; estimateExplanation: string };
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
/** Where the catalog says a food is usually kept (the fridge for a food it doesn't list). */
function usualPlace(name: string): StorageLocation {
  const entry = findReference(name);
  return entry ? usualStorage(entry) : 'FRIDGE';
}

/** How much the quantity stepper moves for a unit. */
export function quantityStep(unit: Unit): number {
  if (unit === 'g' || unit === 'ml') return 50;
  if (unit === 'kg' || unit === 'l') return 0.5;
  return 1;
}

export function FoodForm({ initial, prefill, current, submitLabel, onSubmit, allowAddAnother, autoFocus }: Props) {
  const timeZone = useAuthStore((s) => s.user?.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(timeZone);
  const notesId = useId();
  const unitId = useId();
  const quantityId = useId();
  const storageId = useId();
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? '');
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? prefill?.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? prefill?.unit ?? 'pcs');
  const [addedDate, setAddedDate] = useState(initial?.addedDate ?? prefill?.addedDate ?? today);
  const [leftover, setLeftover] = useState(initial?.leftover ?? prefill?.leftover ?? false);
  // Nobody has to enter a lifespan: the expected expiry is estimated. "Change estimate" reveals the field, and
  // only a lifespan the person typed is sent (the server then marks the source as theirs).
  const [lifespan, setLifespan] = useState(initial?.lifespanDays !== undefined ? String(initial.lifespanDays) : '');
  const [showEstimate, setShowEstimate] = useState(false);
  const [lifespanTouched, setLifespanTouched] = useState(false);
  const [storage, setStorage] = useState<StorageLocation>(
    initial?.storage ?? prefill?.storage ?? (prefill?.name && !prefill.leftover ? usualPlace(prefill.name) : 'FRIDGE'),
  );
  // Once the person picks a place themselves, naming a food no longer moves it.
  const [storageTouched, setStorageTouched] = useState(Boolean(initial?.storage ?? prefill?.storage));
  const [printedDate, setPrintedDate] = useState(initial?.printedDate ?? prefill?.printedDate ?? '');
  const [printedDateType, setPrintedDateType] = useState<PrintedDateType>(
    initial?.printedDateType ?? prefill?.printedDateType ?? 'UNKNOWN',
  );
  const [showPrinted, setShowPrinted] = useState(Boolean(initial?.printedDate ?? prefill?.printedDate));
  const [price, setPrice] = useState(initial?.price == null ? '' : String(initial.price));
  const currency = useAuthStore((s) => s.user?.currency) ?? 'USD';
  const learned = useSuggestionStore((s) => s.learned);
  const loadLearned = useSuggestionStore((s) => s.load);

  // Learned lifespans are only needed when adding (not when editing an item).
  useEffect(() => {
    if (!initial) void loadLearned();
  }, [initial, loadLearned]);
  const [notes, setNotes] = useState(initial?.notes ?? prefill?.notes ?? '');
  // Notes sit behind an "Add note" link unless the item already has some.
  const [showNotes, setShowNotes] = useState(Boolean(initial?.notes ?? prefill?.notes));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  /** How much the + and - change the quantity: 50 for grams and millilitres, a half for kilos and litres, else 1. */
  const step = quantityStep(unit);
  function stepQuantity(direction: 1 | -1) {
    const current = Number(quantity);
    const base = Number.isFinite(current) && quantity.trim() !== '' ? current : 0;
    const next = Math.round((base + direction * step) * 1000) / 1000;
    if (next <= 0) return;
    setQuantity(String(next));
    clearError('quantity');
  }

  const clearError = (field: keyof Errors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  // Your own foods first, then the reference list (hidden once the name is an exact match).
  const suggestions = initial ? [] : searchSuggestions(name, storage, learned);

  /** Picking a suggestion fills in its name and unit, and the place the catalog says it is usually kept. */
  function pick(suggestion: LifespanSuggestion) {
    setName(suggestion.name);
    setUnit(suggestion.unit);
    if (!storageTouched && !initial) setStorage(usualPlace(suggestion.name));
    setErrors({});
  }

  function toggleLeftover(next: boolean) {
    setLeftover(next);
    clearError('lifespanDays');
  }

  function changeStorage(next: StorageLocation) {
    setStorage(next);
    setStorageTouched(true);
  }

  const lifespanNumber = Number(lifespan);
  const lifespanValid =
    lifespan !== '' && Number.isInteger(lifespanNumber) && lifespanNumber >= 0 && lifespanNumber <= 365;

  // Shown for what will be saved. Your own number first; else, when editing, the date the item has now; else the
  // same estimate the server will make (the shared estimateExpiry, with your own history).
  const printedUsable = printedDate !== '' && isUsablePrintedDate(printedDate, today);
  const estimate = useMemo(() => {
    if (!name.trim() || !isValidDate(addedDate)) return null;
    return estimateExpiry({
      product: { name: name.trim() },
      catalogMatch: leftover ? (findReference('Leftovers') ?? null) : undefined,
      category: prefill?.category,
      storage,
      addedDate,
      today,
      printedDate: printedUsable ? printedDate : null,
      printedDateType: printedUsable ? printedDateType : null,
      usageHistory: initial ? [] : learned,
    });
  }, [
    name,
    addedDate,
    leftover,
    prefill?.category,
    storage,
    today,
    printedUsable,
    printedDate,
    printedDateType,
    initial,
    learned,
  ]);

  let shown: { expiryDate: string; label: string; explanation: string } | null = null;
  if (lifespanTouched && lifespanValid && isValidDate(addedDate)) {
    shown = {
      expiryDate: addDays(addedDate, lifespanNumber),
      label: expirySourceLabel('USER'),
      explanation: expiryCopy.userExplanation,
    };
  } else if (initial && current && !lifespanTouched) {
    shown = {
      expiryDate: current.expiryDate,
      label: expirySourceLabel(current.expirySource),
      explanation: current.estimateExplanation,
    };
  } else if (estimate) {
    shown = {
      expiryDate: addDays(addedDate, Math.max(diffDays(addedDate, estimate.expiryDate), 0)),
      label: expirySourceLabel(estimate.source),
      explanation: estimate.explanation,
    };
  }
  const expiryDate = shown?.expiryDate ?? null;

  function validate(): FoodInput | null {
    const { data, errors: found } = check(createFoodSchema, {
      name,
      quantity: toNumber(quantity),
      unit,
      addedDate,
      // Only a lifespan the person typed is sent; otherwise the server estimates it.
      lifespanDays: lifespanTouched ? toNumber(lifespan) : undefined,
      notes,
      storage,
      leftover,
      printedDate: printedUsable ? printedDate : undefined,
      printedDateType: printedUsable ? printedDateType : undefined,
      category: prefill?.category,
      // Blank means no price; when editing, blank clears a price that was set.
      price: price.trim() === '' ? (initial ? null : undefined) : Number(price),
    });
    const next: Errors = { ...found };
    if (
      !next.lifespanDays &&
      lifespanTouched &&
      leftover &&
      storage !== 'FREEZER' &&
      Number(lifespan) > LEFTOVER_MAX_DAYS
    ) {
      next.lifespanDays = MESSAGES.leftoverLifespan;
    }
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
        setLifespanTouched(false);
        setShowEstimate(false);
        setStorage('FRIDGE');
        setStorageTouched(false);
        setPrintedDate('');
        setPrintedDateType('UNKNOWN');
        setShowPrinted(false);
        setNotes('');
        setPrice('');
        setShowNotes(false);
        setLeftover(false);
        setErrors({});
        document.getElementById('food-name')?.focus();
      }
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setErrors({ form: describeError(err, 'save that') });
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
          // A food the catalog knows goes where it is usually kept, until you choose a place yourself.
          if (!initial && !storageTouched && findReference(e.target.value)) setStorage(usualPlace(e.target.value));
          clearError('name');
        }}
        error={errors.name}
      />
      {suggestions.length > 0 && (
        <div role="group" aria-label="Suggestions" className="-mx-4 -mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {suggestions.map((suggestion) => {
            return (
              <Chip key={suggestion.name} onClick={() => pick(suggestion)}>
                {suggestion.source === 'learned' && <Star aria-label="your usual" className="size-4 fill-current" />}
                {suggestion.name}
              </Chip>
            );
          })}
        </div>
      )}

      <label className="-ml-2.5 flex min-h-12 cursor-pointer items-center gap-1">
        <Checkbox checked={leftover} onChange={(e) => toggleLeftover(e.target.checked)} />
        <span>
          <span className="block font-medium">{leftoverCopy.label}</span>
          <span className="block text-sm text-muted">{leftoverCopy.hint(LEFTOVER_MAX_DAYS)}</span>
        </span>
      </label>

      <div>
        <label htmlFor={quantityId} className="mb-1.5 block text-sm font-medium text-ink">
          Quantity
        </label>
        {/* A + and - stepper around the number, which can still be typed (with a number keyboard on a phone). */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease quantity"
            disabled={!(Number(quantity) - step > 0)}
            onClick={() => stepQuantity(-1)}
            className="grid size-12 shrink-0 place-items-center rounded-full border border-field bg-card text-ink hover:bg-brand-soft disabled:opacity-40"
          >
            <Minus aria-hidden className="size-5" strokeWidth={2.5} />
          </button>
          <input
            id={quantityId}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            aria-invalid={errors.quantity ? true : undefined}
            aria-describedby={errors.quantity ? `${quantityId}-error` : undefined}
            onChange={(e) => {
              setQuantity(e.target.value);
              clearError('quantity');
            }}
            className={`block min-h-12 w-24 rounded-button border bg-card px-3 text-center text-base text-ink focus:border-brand focus:outline-none ${
              errors.quantity ? 'border-danger' : 'border-field'
            }`}
          />
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => stepQuantity(1)}
            className="grid size-12 shrink-0 place-items-center rounded-full border border-field bg-card text-ink hover:bg-brand-soft"
          >
            <Plus aria-hidden className="size-5" strokeWidth={2.5} />
          </button>
        </div>
        {errors.quantity && (
          <p id={`${quantityId}-error`} className="mt-1.5 text-sm text-danger">
            {errors.quantity}
          </p>
        )}
      </div>

      <Field
        className="w-40"
        label={`Price (${currency}, optional)`}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        placeholder="What it cost"
        value={price}
        onChange={(e) => {
          setPrice(e.target.value);
          clearError('price');
        }}
        error={errors.price}
        hint={screenCopy.form.priceHint}
      />

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
          className={`block min-h-12 w-40 rounded-button border bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none ${
            errors.unit ? 'border-danger' : 'border-field'
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
          className="block min-h-12 w-40 rounded-button border border-field bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none"
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

      {!showPrinted ? (
        <button
          type="button"
          onClick={() => setShowPrinted(true)}
          className="inline-flex min-h-12 items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
        >
          + {expiryCopy.addPrinted}
        </button>
      ) : (
        <div className="space-y-2">
          <Field
            label={expiryCopy.printedLabel}
            type="date"
            value={printedDate}
            onChange={(e) => setPrintedDate(e.target.value)}
            hint={printedDate !== '' && !printedUsable ? expiryCopy.printedIgnored : expiryCopy.printedHint}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label={expiryCopy.printedTypeLabel}>
            {PRINTED_DATE_TYPES.filter((type) => type !== 'UNKNOWN').map((type) => (
              <Chip key={type} selected={printedDateType === type} onClick={() => setPrintedDateType(type)}>
                {expiryCopy.printedTypes[type]}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {!showNotes ? (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="inline-flex min-h-12 items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
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
            className={`block w-full rounded-button border bg-card px-3.5 py-3 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none ${
              errors.notes ? 'border-danger' : 'border-field'
            }`}
          />
          <p className={`mt-1.5 text-sm ${errors.notes ? 'text-danger' : 'text-muted'}`}>
            {errors.notes ?? `${notes.length}/${NOTES_MAX}`}
          </p>
        </div>
      )}

      <div aria-live="polite" className="space-y-2 rounded-card bg-brand-soft px-4 py-3">
        <p className="text-base font-semibold text-ink">
          {expiryDate
            ? screenCopy.form.preview(formatDisplay(expiryDate), diffDays(today, expiryDate))
            : screenCopy.form.previewEmpty}
          {shown && <span className="ml-2 text-sm font-normal text-muted">· {shown.label}</span>}
        </p>
        {shown && <p className="text-sm leading-snug text-muted">{shown.explanation}</p>}
        {!showEstimate && (
          <button
            type="button"
            onClick={() => setShowEstimate(true)}
            className="inline-flex min-h-12 items-center text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            {expiryCopy.changeEstimate}
          </button>
        )}
        <EstimateNote />
      </div>

      {showEstimate && (
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
              setLifespanTouched(true);
              clearError('lifespanDays');
            }}
            error={errors.lifespanDays}
            hint={screenCopy.form.lifespanHint}
          />
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            {LIFESPAN_PICKS.map((d) => (
              <Chip
                key={d}
                selected={lifespanTouched && lifespan === String(d)}
                onClick={() => {
                  setLifespan(String(d));
                  setLifespanTouched(true);
                  clearError('lifespanDays');
                }}
              >
                {d} {d === 1 ? 'day' : 'days'}
              </Chip>
            ))}
          </div>
        </div>
      )}

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
