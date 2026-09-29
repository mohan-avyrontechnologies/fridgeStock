import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { FoodInput } from '../api/types';
import { remainingText, screenCopy } from '../copy';
import { addDaysToKey, daysBetween, formatDateKey, localDateKey } from '../lib/dates';
import { Button, Chip, Field, FormError } from './ui';

const UNITS = ['pcs', 'g', 'kg', 'ml', 'l', 'pack', 'bunch'];
const LIFESPANS = [1, 2, 3, 5, 7, 14];

type Errors = Partial<Record<keyof FoodInput | 'form', string>>;

interface Props {
  initial?: FoodInput;
  submitLabel: string;
  /** Resolves when saved. `addAnother` is set when the secondary button was used. */
  onSubmit: (input: FoodInput, addAnother: boolean) => Promise<void>;
  allowAddAnother?: boolean;
  autoFocus?: boolean;
}

/**
 * Only the five fields the app needs. Chips cover the common cases so most
 * items need nothing typed except the name. Client checks are for speed only;
 * the server re-validates everything.
 */
export function FoodForm({ initial, submitLabel, onSubmit, allowAddAnother, autoFocus }: Props) {
  const today = localDateKey();
  const [name, setName] = useState(initial?.name ?? '');
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [unit, setUnit] = useState(initial?.unit ?? 'pcs');
  const [customUnit, setCustomUnit] = useState(initial && !UNITS.includes(initial.unit));
  const [addedDate, setAddedDate] = useState(initial?.addedDate ?? today);
  const [lifespan, setLifespan] = useState(initial ? String(initial.lifespanDays) : '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const clearError = (field: keyof Errors) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const lifespanNumber = Number(lifespan);
  const previewValid = lifespan !== '' && Number.isInteger(lifespanNumber) && lifespanNumber >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(addedDate);
  const expiryKey = previewValid ? addDaysToKey(addedDate, lifespanNumber) : null;

  function validate(): FoodInput | null {
    const next: Errors = {};
    const q = Number(quantity);
    if (!name.trim()) next.name = 'Food name is required.';
    if (!quantity || !Number.isFinite(q) || q <= 0) next.quantity = 'Quantity must be a positive number.';
    if (!unit.trim()) next.unit = 'Unit is required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(addedDate)) next.addedDate = 'Added date could not be parsed.';
    else if (addedDate > today) next.addedDate = 'Added date can’t be in the future.';
    if (lifespan === '' || !Number.isInteger(lifespanNumber) || lifespanNumber < 0) {
      next.lifespanDays = 'Lifespan must be zero or a positive number of days.';
    }
    setErrors(next);
    if (Object.keys(next).length) return null;
    return { name: name.trim(), quantity: q, unit: unit.trim(), addedDate, lifespanDays: lifespanNumber };
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
        autoFocus={autoFocus}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          clearError('name');
        }}
        error={errors.name}
      />

      <div>
        <div className="flex gap-3">
          <Field
            className="w-28 shrink-0"
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
          {customUnit && (
            <Field className="flex-1" label="Unit" value={unit} onChange={(e) => {
                setUnit(e.target.value);
                clearError('unit');
              }} error={errors.unit} />
          )}
        </div>
        <fieldset className="mt-3 min-w-0">
          <legend className="sr-only">Unit</legend>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {UNITS.map((u) => (
              <Chip
                key={u}
                selected={!customUnit && unit === u}
                onClick={() => {
                  setCustomUnit(false);
                  setUnit(u);
                  clearError('unit');
                }}
              >
                {u}
              </Chip>
            ))}
            <Chip
              selected={!!customUnit}
              onClick={() => {
                setCustomUnit(true);
                setUnit('');
              }}
            >
              Other…
            </Chip>
          </div>
          {!customUnit && errors.unit && <p className="mt-1.5 text-sm text-danger">{errors.unit}</p>}
        </fieldset>
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
          <Chip selected={addedDate === today} onClick={() => {
            setAddedDate(today);
            clearError('addedDate');
          }}>
            Today
          </Chip>
          <Chip selected={addedDate === addDaysToKey(today, -1)} onClick={() => setAddedDate(addDaysToKey(today, -1))}>
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
          step="1"
          placeholder="How many days you expect it to last"
          value={lifespan}
          onChange={(e) => {
            setLifespan(e.target.value);
            clearError('lifespanDays');
          }}
          error={errors.lifespanDays}
          hint={screenCopy.form.lifespanHint}
        />
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {LIFESPANS.map((d) => (
            <Chip key={d} selected={lifespan === String(d)} onClick={() => {
              setLifespan(String(d));
              clearError('lifespanDays');
            }}>
              {d} {d === 1 ? 'day' : 'days'}
            </Chip>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="rounded-2xl bg-brand-soft px-4 py-3">
        <p className="text-sm text-muted">{screenCopy.form.previewLabel}</p>
        <p className="text-base font-semibold text-ink">
          {expiryKey ? `${formatDateKey(expiryKey)} · ${remainingText(daysBetween(today, expiryKey))}` : screenCopy.form.previewEmpty}
        </p>
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
