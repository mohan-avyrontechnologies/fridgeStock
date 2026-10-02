import { X } from 'lucide-react';
import {
  addDays,
  bulkCreateSchema,
  FOOD_REFERENCE,
  MESSAGES,
  STORAGE_LOCATIONS,
  todayInTz,
  UNITS,
  type BulkCreateInput,
  type LearnedLifespan,
  type ReceiptItem,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { CameraScreen } from '../components/CameraScreen';
import { EstimateNote } from '../components/Urgency';
import { Button, Chip, Field, FormError, Spinner, Card } from '../components/ui';
import { bulkCopy, cameraCopy, productPhotoCopy, receiptCopy, referenceCopy, storageLabel } from '../copy';
import { BlobThumb } from '../lib/foodPhoto';
import { fieldsFor, type ScannedItem } from '../lib/scanned';
import { photoForUpload } from '../lib/image';
import { pickPhoto } from '../platform/pickPhoto';
import { firstSuggestion, suggestFor } from '../lib/suggestions';
import { check } from '../lib/validation';
import { useAiStore } from '../stores/aiStore';
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
  /** Optional: what the line cost. */
  price: string;
  /** A note carried over from a scan (the brand). Not shown; it is saved with the food. */
  notes?: string;
  /** The photo taken for it, kept with the food when it is saved. */
  photo?: Blob;
}

let nextKey = 0;
const emptyRow = (): Row => ({
  key: nextKey++,
  name: '',
  quantity: '1',
  unit: 'pcs',
  lifespan: '',
  storage: 'FRIDGE',
  price: '',
});

/** A row from a receipt line, with a lifespan suggested from your own usual first, then the reference list. */
function rowFromReceipt(item: ReceiptItem, learned: LearnedLifespan[]): Row {
  const base: Row = {
    ...emptyRow(),
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit,
    price: item.price === null ? '' : String(item.price),
  };
  const suggestion = firstSuggestion(item.name, learned);
  return suggestion ? { ...base, storage: suggestion.storage, lifespan: String(suggestion.days) } : base;
}
/** A row from a scanned product, with the usual lifespan and place for a food the catalog knows. */
function rowFromScanned(item: ScannedItem, learned: LearnedLifespan[]): Row {
  const fields = fieldsFor(item, learned);
  return {
    ...emptyRow(),
    name: fields.name,
    quantity: String(fields.quantity ?? 1),
    unit: fields.unit ?? 'pcs',
    lifespan: fields.lifespanDays === undefined ? '' : String(fields.lifespanDays),
    storage: fields.storage ?? 'FRIDGE',
    ...(fields.notes && { notes: fields.notes }),
    ...(item.photo && { photo: item.photo }),
  };
}
const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));
const isBlank = (row: Row) => !row.name.trim() && !row.lifespan.trim();

const inputClass =
  'block min-h-12 w-full rounded-button border bg-card px-2.5 text-base text-ink focus:border-brand focus:outline-none';

/** Add a whole shopping haul at once: one row per item, sharing an added date. */
export function BulkAddPage() {
  const timeZone = useAuthStore((s) => s.user?.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(timeZone);
  const addBulk = useFoodStore((s) => s.addBulk);
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();
  const listId = useId();
  const [addedDate, setAddedDate] = useState(today);
  // Several products scanned on Add Food arrive here as rows to check.
  const scannedOnArrival = ((useLocation().state as { scanned?: ScannedItem[] } | null)?.scanned ??
    []) as ScannedItem[];
  const savePhotos = useAuthStore((s) => s.user?.savePhotos ?? true);
  const [camera, setCamera] = useState(false);
  const [fromScan, setFromScan] = useState(scannedOnArrival.length > 0);
  const [rows, setRows] = useState<Row[]>(() =>
    scannedOnArrival.length > 0
      ? scannedOnArrival.map((item) => rowFromScanned(item, []))
      : [emptyRow(), emptyRow(), emptyRow()],
  );
  // Errors keyed by "<row key>.<field>", plus "form" and "addedDate".
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const learned = useSuggestionStore((s) => s.learned);
  const loadLearned = useSuggestionStore((s) => s.load);
  const aiEnabled = useAiStore((s) => s.status?.enabled ?? false);
  const loadAi = useAiStore((s) => s.load);
  const photoInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [fromReceipt, setFromReceipt] = useState(false);

  useEffect(() => {
    void loadLearned();
    void loadAi();
  }, [loadLearned, loadAi]);

  const filled = rows.filter((r) => !isBlank(r));

  /** The receipt photo is read by the AI; the lines become rows to check. Nothing is saved here. */
  async function readReceipt(file: File) {
    setReading(true);
    setErrors({});
    try {
      const { mediaType, image } = await photoForUpload(file);
      const draft = await api.readReceipt({ mediaType, image });
      if (draft.items.length === 0) {
        toast(receiptCopy.none);
        return;
      }
      setRows((prev) => [
        ...prev.filter((row) => !isBlank(row)),
        ...draft.items.map((i) => rowFromReceipt(i, learned)),
      ]);
      if (draft.purchaseDate) setAddedDate(draft.purchaseDate);
      setFromReceipt(true);
      toast(receiptCopy.found(draft.items.length));
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : receiptCopy.error });
    } finally {
      setReading(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

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
        price: r.price.trim() === '' ? undefined : Number(r.price),
        notes: r.notes,
      })),
    };
    const { data, errors: found } = check(bulkCreateSchema, input);
    if (found) return showErrors(Object.entries(found)[0]!);
    if (addedDate > today) return showErrors(['addedDate', MESSAGES.addedDate]);

    setBusy(true);
    try {
      const items = await addBulk(data as BulkCreateInput);
      // Photos go up once the food exists, in the order it was added. If one can't be kept the food is still saved.
      let missed = false;
      if (savePhotos) {
        for (const [i, row] of filled.entries()) {
          if (!row.photo || !items[i]) continue;
          try {
            await api.uploadFoodPhoto(items[i].id, row.photo);
          } catch {
            missed = true;
          }
        }
        void useFoodStore.getState().refresh();
      }
      toast(missed ? productPhotoCopy.someNotKept : bulkCopy.added(items.length));
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
        {camera && (
          <CameraScreen
            onClose={() => setCamera(false)}
            onDone={(items) => {
              setCamera(false);
              setFromScan(true);
              setRows((prev) => [
                ...prev.filter((row) => !isBlank(row)),
                ...items.map((item) => rowFromScanned(item, learned)),
              ]);
            }}
          />
        )}
        <form onSubmit={submit} className="space-y-5" noValidate>
          <FormError message={errors.form ?? null} />

          {fromScan && (
            <p className="rounded-button bg-brand-soft px-3.5 py-3 text-sm text-ink">
              {cameraCopy.fromScan(filled.length)}
            </p>
          )}
          <Button type="button" variant="secondary" className="w-full" onClick={() => setCamera(true)}>
            {cameraCopy.scanMore}
          </Button>

          {aiEnabled && (
            <Card as="section" aria-labelledby="receipt-title" className="space-y-2 p-4">
              <h2 id="receipt-title" className="text-base font-semibold">
                {receiptCopy.title}
              </h2>
              <p className="text-sm text-muted">{receiptCopy.hint}</p>
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Receipt photo"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readReceipt(file);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={reading}
                onClick={() => void pickPhoto(photoInput.current, readReceipt)}
              >
                {reading ? receiptCopy.reading : receiptCopy.button}
              </Button>
              {reading && <Spinner label={receiptCopy.reading} />}
              {fromReceipt && !reading && <p className="text-sm text-muted">{receiptCopy.checkNote}</p>}
            </Card>
          )}

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
                <Card as="li" key={row.key} className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    {row.photo && (
                      <BlobThumb
                        blob={row.photo}
                        alt={`Photo of ${row.name || label}`}
                        className="size-12 shrink-0 rounded-lg object-cover"
                      />
                    )}
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
                        className="grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-paper"
                      >
                        <X aria-hidden className="size-5" />
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
                      Price (optional)
                      <input
                        aria-label={`${label} price`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 2.50"
                        value={row.price}
                        onChange={(e) => update(row.key, { price: e.target.value })}
                        className={`${inputClass} ${err('price') ? 'border-danger' : 'border-line'}`}
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
                  {['name', 'quantity', 'lifespanDays', 'unit', 'storage', 'price'].map(
                    (f) =>
                      err(f) && (
                        <p key={f} className="text-sm text-danger">
                          {err(f)}
                        </p>
                      ),
                  )}
                </Card>
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
