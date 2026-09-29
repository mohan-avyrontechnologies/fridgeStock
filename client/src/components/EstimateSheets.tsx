import {
  findReference,
  formatDisplay,
  isValidDate,
  MESSAGES,
  STORAGE_LOCATIONS,
  todayInTz,
  type FoodItem,
  type StorageLocation,
} from '@cook-first/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { moveCopy, openCopy, referenceCopy, storageLabel, undoCopy } from '../copy';
import { suggestFor } from '../lib/suggestions';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Chip, Field, FormError } from './ui';

/** Phase 2 sheets: "Opened" and "Move", both of which change the expected expiry. */

const toDays = (value: string) => (value.trim() === '' ? undefined : Number(value));
const validDays = (n: number | undefined) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 365;

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, button[data-autofocus]')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-sheet-title"
        className="sheet-in bottom-inset relative w-full max-w-md rounded-t-3xl bg-card px-4 pt-3 pb-4 shadow-xl sm:rounded-3xl"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <h2 id="estimate-sheet-title" className="mb-4 px-1 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function SheetButtons({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
        {undoCopy.cancel}
      </Button>
      <Button type="submit" className="flex-1" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

/** Marks the item as opened. The expected expiry can only get shorter; the toast offers Undo. */
export function OpenSheet({
  item,
  onDone,
  onClose,
}: {
  item: FoodItem;
  onDone: (f: FoodItem) => void;
  onClose: () => void;
}) {
  const timeZone = useAuthStore((s) => s.user?.timeZone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = todayInTz(timeZone);
  const open = useFoodStore((s) => s.open);
  const undoOpen = useFoodStore((s) => s.undoOpen);
  const toast = useToastStore((s) => s.show);
  const typical = findReference(item.name)?.openedDays ?? null;
  const [openedDate, setOpenedDate] = useState(today);
  const [days, setDays] = useState(typical === null ? '' : String(typical));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = toDays(days);
    if (!isValidDate(openedDate) || openedDate > today || openedDate < item.addedDate)
      return setError(MESSAGES.openedDate);
    if (!validDays(n)) return setError(n === undefined ? MESSAGES.openedDaysNeeded : MESSAGES.daysLeft);
    setBusy(true);
    try {
      const updated = await open(item.id, { openedDate, daysLeft: n });
      toast(openCopy.toast(item.name, formatDisplay(updated.expiryDate)), {
        label: undoCopy.label,
        onClick: () => void undoOpen(item.id).then(onDone, () => toast(undoCopy.failed)),
      });
      onDone(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Sheet title={openCopy.title(item.name)} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <div>
          <Field
            label={openCopy.openedOn}
            type="date"
            min={item.addedDate}
            max={today}
            value={openedDate}
            onChange={(e) => setOpenedDate(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Chip selected={openedDate === today} onClick={() => setOpenedDate(today)}>
              Today
            </Chip>
          </div>
        </div>
        <Field
          label={openCopy.daysLabel}
          type="number"
          inputMode="numeric"
          min="0"
          max="365"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint={typical === null ? openCopy.hint : `${openCopy.referenceHint(typical)} ${openCopy.hint}`}
        />
        <SheetButtons busy={busy} onCancel={onClose} />
      </form>
    </Sheet>
  );
}

/** Moves the item to another location; the expected expiry is recalculated from today. */
export function MoveSheet({
  item,
  onDone,
  onClose,
}: {
  item: FoodItem;
  onDone: (f: FoodItem) => void;
  onClose: () => void;
}) {
  const move = useFoodStore((s) => s.move);
  const toast = useToastStore((s) => s.show);
  const learned = useSuggestionStore((s) => s.learned);
  const loadLearned = useSuggestionStore((s) => s.load);
  const others = STORAGE_LOCATIONS.filter((loc) => loc !== item.storage);
  const suggestionFor = (loc: StorageLocation) => suggestFor(item.name, loc, learned)?.days ?? null;
  const [storage, setStorage] = useState<StorageLocation>(others.includes('FREEZER') ? 'FREEZER' : others[0]!);
  const [days, setDays] = useState(() => String(suggestionFor(storage) ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadLearned();
  }, [loadLearned]);

  function choose(loc: StorageLocation) {
    setStorage(loc);
    const suggestion = suggestionFor(loc);
    setDays(suggestion === null ? '' : String(suggestion));
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = toDays(days);
    if (!validDays(n)) return setError(n === undefined ? MESSAGES.storageDaysNeeded : MESSAGES.daysLeft);
    setBusy(true);
    try {
      const updated = await move(item.id, { storage, daysLeft: n });
      toast(moveCopy.toast(item.name, storageLabel[storage], formatDisplay(updated.expiryDate)));
      onDone(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const suggestion = suggestFor(item.name, storage, learned);

  return (
    <Sheet title={moveCopy.title(item.name)} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">{moveCopy.where}</legend>
          <div className="flex gap-2">
            {others.map((loc) => (
              <Chip key={loc} selected={storage === loc} onClick={() => choose(loc)}>
                {storageLabel[loc]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field
          label={moveCopy.daysLabel(storageLabel[storage])}
          type="number"
          inputMode="numeric"
          min="0"
          max="365"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint={
            !suggestion || suggestion.days === null
              ? referenceCopy.notUsuallyKept(storageLabel[storage])
              : suggestion.source === 'learned'
                ? referenceCopy.learned(suggestion.days, suggestion.basedOn!)
                : `${referenceCopy.suggested(suggestion.days)}. ${referenceCopy.hint}`
          }
        />
        <SheetButtons busy={busy} onCancel={onClose} />
      </form>
    </Sheet>
  );
}
