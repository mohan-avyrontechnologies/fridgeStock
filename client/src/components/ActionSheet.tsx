import { MESSAGES, type FoodItem } from '@cook-first/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { actionCopy, undoCopy } from '../copy';
import { formatQuantity } from '../lib/format';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Field, FormError } from './ui';

type Action = 'USED' | 'PARTIALLY_USED' | 'WASTED' | 'REMOVED';

/**
 * Records what happened to an item straight away and shows a toast with
 * "Undo" (Phase 1: undo messages replace confirmation dialogs). Returns
 * whether the item is now closed.
 */
export function useFoodActions() {
  const act = useFoodStore((s) => s.act);
  const undo = useFoodStore((s) => s.undo);
  const toast = useToastStore((s) => s.show);

  return async function run(item: FoodItem, action: Action, quantity?: number): Promise<boolean> {
    await act(item.id, action, quantity);
    // Using part of it leaves the item open; the server closes it if the whole amount was used.
    const stillOpen = action === 'PARTIALLY_USED' && quantity! < item.quantity;
    const done = stillOpen ? 'PARTIALLY_USED' : action === 'PARTIALLY_USED' ? 'USED' : action;
    toast(`${actionCopy[done].past}: ${item.name}`, {
      label: undoCopy.label,
      onClick: () => {
        undo(item.id).then(
          () => toast(undoCopy.restored(item.name)),
          () => toast(undoCopy.failed),
        );
      },
    });
    return !stillOpen;
  };
}

/**
 * Where the sheet opens:
 * - 'used': choose "Used all" or "Used some" (a card's "Used" button)
 * - 'amount': ask how much was used ("Used some")
 */
export type SheetStep = 'used' | 'amount';

/** Bottom sheet for "Used all" / "Used some". Nothing here asks for confirmation; "Undo" follows instead. */
export function ActionSheet({
  item,
  initialStep,
  onClose,
}: {
  item: FoodItem;
  initialStep: SheetStep;
  onClose: (closed: boolean) => void;
}) {
  const run = useFoodActions();
  const [step, setStep] = useState<SheetStep>(initialStep);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // Keep the latest onClose for the Escape handler without re-binding it.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Move focus into the sheet when it opens and when it switches step.
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>('input, [data-autofocus]')?.focus();
  }, [step]);

  async function perform(action: Action, quantity?: number) {
    setBusy(true);
    setError(null);
    try {
      onClose(await run(item, action, quantity));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  function submitAmount(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      setError(MESSAGES.quantity);
      return;
    }
    void perform('PARTIALLY_USED', n);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={() => onClose(false)} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className="sheet-in bottom-inset relative w-full max-w-md rounded-t-3xl bg-card px-4 pt-3 shadow-xl sm:rounded-3xl sm:pb-4"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <h2 id="sheet-title" className="px-1 text-lg font-semibold">
          {item.name}
        </h2>
        <p className="px-1 text-sm text-muted">You have {formatQuantity(item.quantity, item.unit)}</p>

        <div className="mt-4 space-y-2 pb-4">
          <FormError message={error} />

          {step === 'used' && (
            <>
              <SheetOption
                autoFocus
                title={actionCopy.USED.label}
                detail="Finished all of it"
                disabled={busy}
                onClick={() => perform('USED')}
              />
              <SheetOption
                title={actionCopy.PARTIALLY_USED.label}
                detail="Keep the rest on your list"
                disabled={busy}
                onClick={() => {
                  setStep('amount');
                  setError(null);
                  setAmount('');
                }}
              />
            </>
          )}

          {step === 'amount' && (
            <form onSubmit={submitAmount} className="space-y-3" noValidate>
              <Field
                label={`How much did you use? (${item.unit})`}
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                hint={`Up to ${formatQuantity(item.quantity, item.unit)}. Using all of it closes the item.`}
              />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => onClose(false)}>
                  {undoCopy.cancel}
                </Button>
                <Button type="submit" className="flex-1" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function SheetOption({
  title,
  detail,
  onClick,
  disabled,
  autoFocus,
}: {
  autoFocus?: boolean;
  title: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-autofocus={autoFocus || undefined}
      className="flex w-full min-h-14 flex-col items-start justify-center rounded-2xl border border-line px-4 py-2.5 text-left hover:bg-paper disabled:opacity-60"
    >
      <span className="text-[15px] font-semibold text-ink">{title}</span>
      <span className="text-sm text-muted">{detail}</span>
    </button>
  );
}
