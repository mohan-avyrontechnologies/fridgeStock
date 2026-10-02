import { PHOTO_CONFIDENCE_MIN, type FoodItem, type PhotoCheck as PhotoCheckResult } from '@cook-first/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { photoCopy } from '../copy';
import { photoForUpload } from '../lib/image';
import { useAiStore } from '../stores/aiStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Spinner } from './ui';

type Props =
  | {
      /** Add Food: a photo of something not at home yet. The name it finds can pre-fill the form. */
      mode: 'add';
      /** Called with a confident identification. Below the confidence limit it is not called at all. */
      onIdentified: (check: PhotoCheckResult) => void;
    }
  | {
      /** Food Details: a photo of an item at home. Warning signs offer to waste it or use it today. */
      mode: 'item';
      food: FoodItem;
      onWaste: () => void;
      onFoodChanged: (food: FoodItem) => void;
    };

/**
 * Photo Check: the AI names the food in a photo and may point out visible warning signs. It changes
 * nothing by itself. When it finds no warning signs the app says nothing about condition at all;
 * there is no "looks fine" message anywhere.
 */
export function PhotoCheck(props: Props) {
  const toast = useToastStore((s) => s.show);
  const enabled = useAiStore((s) => s.status?.photoCheck ?? false);
  const loadAi = useAiStore((s) => s.load);
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signs, setSigns] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  // With the feature flag or AI off, no photo controls are shown.
  if (!enabled) return null;

  const item = props.mode === 'item' ? props.food : null;
  // "Use today" is only for an item whose expected expiry is later than today, so it can never move it later.
  const canUseToday = item !== null && item.remainingDays !== null && item.remainingDays > 0;

  async function read(file: File) {
    setReading(true);
    setError(null);
    setNotice(null);
    setSigns(null);
    setConfirming(false);
    try {
      const photo = await photoForUpload(file);
      const result = await api.checkPhoto(props.mode === 'item' ? { ...photo, foodId: props.food.id } : photo);
      if (props.mode === 'add') {
        if (result.confidence < PHOTO_CONFIDENCE_MIN) setNotice(photoCopy.unsure);
        else {
          props.onIdentified(result);
          toast(photoCopy.looksLike(result.name));
        }
      } else if (result.warningSigns.length === 0) {
        toast(photoCopy.checked);
      }
      if (result.warningSigns.length > 0) setSigns(result.warningSigns.map((sign) => sign.description));
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : photoCopy.error);
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function useToday() {
    if (props.mode !== 'item') return;
    setBusy(true);
    try {
      props.onFoodChanged(await api.useToday(props.food.id));
      toast(photoCopy.dueToday(props.food.name));
      setSigns(null);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : photoCopy.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={photoCopy.region} className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={photoCopy.inputLabel}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={reading}
        onClick={() => input.current?.click()}
      >
        {reading ? photoCopy.reading : props.mode === 'item' ? photoCopy.checkButton : photoCopy.addButton}
      </Button>
      {reading && <Spinner label={photoCopy.reading} />}
      {error && (
        <p role="alert" className="rounded-xl bg-past px-3.5 py-3 text-sm text-past-ink">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-calm px-3.5 py-3 text-sm text-calm-ink">
          {notice}
        </p>
      )}

      {signs && (
        <div
          role="group"
          aria-label={photoCopy.signsRegion}
          className="space-y-3 rounded-2xl bg-soon px-4 py-3 text-soon-ink"
        >
          <p>{photoCopy.signs(signs)}</p>
          {confirming && item ? (
            <div className="space-y-2">
              <p className="font-medium">{photoCopy.confirmUseToday(item.name)}</p>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={useToday}>
                  {photoCopy.confirm}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {photoCopy.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {props.mode === 'item' && (
                <Button variant="danger" onClick={props.onWaste}>
                  {photoCopy.waste}
                </Button>
              )}
              {canUseToday && (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  {photoCopy.useToday}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setSigns(null)}>
                {photoCopy.dismiss}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
