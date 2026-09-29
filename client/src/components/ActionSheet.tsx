import { MESSAGES, type FoodItem } from '@cook-first/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { actionCopy } from '../copy';
import { formatQuantity } from '../lib/format';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Field, FormError } from './ui';

type Mode = 'choose' | 'PARTIALLY_USED';
type Action = 'USED' | 'PARTIALLY_USED' | 'WASTED' | 'REMOVED';

/**
 * Bottom sheet for recording what happened to an item. "Used it all",
 * "Threw it away" and "Remove" are one tap and close the whole item; only
 * "Used some" asks for an amount.
 */
export function ActionSheet({ item, onClose }: { item: FoodItem; onClose: (closed: boolean) => void }) {
  const act = useFoodStore((s) => s.act);
  const toast = useToastStore((s) => s.show);
  const [mode, setMode] = useState<Mode>('choose');
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
  }, [mode]);

  async function run(action: Action, quantity?: number) {
    setBusy(true);
    setError(null);
    try {
      await act(item.id, action, quantity);
      // Using some of it leaves the item open; everything else closes it.
      const stillOpen = action === 'PARTIALLY_USED' && quantity! < item.quantity;
      toast(`${actionCopy[stillOpen ? 'PARTIALLY_USED' : action === 'PARTIALLY_USED' ? 'USED' : action].past}: ${item.name}`);
      onClose(!stillOpen);
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
    void run('PARTIALLY_USED', n);
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
          {mode === 'choose' ? (
            <>
              <SheetOption autoFocus title={actionCopy.USED.label} detail="Finished all of it" disabled={busy} onClick={() => run('USED')} />
              <SheetOption
                title={actionCopy.PARTIALLY_USED.label}
                detail="Keep the rest on your list"
                disabled={busy}
                onClick={() => {
                  setMode('PARTIALLY_USED');
                  setError(null);
                  setAmount('');
                }}
              />
              <SheetOption title={actionCopy.WASTED.label} detail="Discarded all of it" disabled={busy} onClick={() => run('WASTED')} />
              <SheetOption
                title={actionCopy.REMOVED.label}
                detail="Added by mistake, given away, or moved elsewhere"
                disabled={busy}
                onClick={() => run('REMOVED')}
              />
            </>
          ) : (
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
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('choose')}>
                  Back
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
