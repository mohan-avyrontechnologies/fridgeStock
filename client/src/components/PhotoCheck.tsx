import type { FoodItem } from '@cook-first/shared';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { photoCopy } from '../copy';
import { photoForUpload } from '../lib/image';
import { pickPhoto } from '../platform/pickPhoto';
import { useAiStore } from '../stores/aiStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Spinner } from './ui';

interface Props {
  food: FoodItem;
  onWaste: () => void;
  onFoodChanged: (food: FoodItem) => void;
}

/**
 * Photo Check on Food Details: a photo of an item at home. The AI may point out visible warning signs, and
 * then offers to mark the item as wasted or to make it due today (only when its expected expiry is later
 * than today, and only after you confirm). It changes nothing by itself. When it finds no warning signs the
 * app says nothing about condition at all; there is no "looks fine" message anywhere.
 *
 * (Naming a new food from a photo happens on the camera screen on Add Food.)
 */
export function PhotoCheck({ food, onWaste, onFoodChanged }: Props) {
  const toast = useToastStore((s) => s.show);
  const enabled = useAiStore((s) => s.status?.photoCheck ?? false);
  const loadAi = useAiStore((s) => s.load);
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signs, setSigns] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  // With the feature flag or AI off, no photo controls are shown.
  if (!enabled) return null;

  // "Use today" is only for an item whose expected expiry is later than today, so it can never move it later.
  const canUseToday = food.remainingDays !== null && food.remainingDays > 0;

  async function read(file: File) {
    setReading(true);
    setError(null);
    setSigns(null);
    setConfirming(false);
    try {
      const { mediaType, image } = await photoForUpload(file);
      const result = await api.checkPhoto({ mediaType, image, foodId: food.id });
      if (result.warningSigns.length === 0) toast(photoCopy.checked);
      else setSigns(result.warningSigns.map((sign) => sign.description));
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : photoCopy.error);
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function useToday() {
    setBusy(true);
    try {
      onFoodChanged(await api.useToday(food.id));
      toast(photoCopy.dueToday(food.name));
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
        onClick={() => void pickPhoto(input.current, read)}
      >
        {reading ? photoCopy.reading : photoCopy.checkButton}
      </Button>
      {reading && <Spinner label={photoCopy.reading} />}
      {error && (
        <p role="alert" className="rounded-xl bg-past px-3.5 py-3 text-sm text-past-ink">
          {error}
        </p>
      )}

      {signs && (
        <div
          role="group"
          aria-label={photoCopy.signsRegion}
          className="space-y-3 rounded-2xl bg-soon px-4 py-3 text-soon-ink"
        >
          <p>{photoCopy.signs(signs)}</p>
          {confirming ? (
            <div className="space-y-2">
              <p className="font-medium">{photoCopy.confirmUseToday(food.name)}</p>
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
              <Button variant="danger" onClick={onWaste}>
                {photoCopy.waste}
              </Button>
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
