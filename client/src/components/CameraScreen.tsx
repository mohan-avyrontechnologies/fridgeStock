import { X } from 'lucide-react';
import { cleanBarcode, isValidBarcode, MESSAGES, PHOTO_CONFIDENCE_MIN } from '@cook-first/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api/client';
import { cameraCopy, photoCopy } from '../copy';
import { cameraSupported, startCameraScan } from '../lib/barcodeCamera';
import { platform } from '../platform';
import { pickPhoto } from '../platform/pickPhoto';
import { BlobThumb } from '../lib/foodPhoto';
import { photoForUpload } from '../lib/image';
import { formatQuantity } from '../lib/format';
import type { ScannedItem } from '../lib/scanned';
import { useAiStore } from '../stores/aiStore';
import { Button, Field, Spinner, Card } from './ui';

type Mode = 'barcode' | 'photo';

interface Props {
  /** Called with everything scanned. One item fills in Add Food; several make a Bulk Add list. */
  onDone: (items: ScannedItem[]) => void;
  onClose: () => void;
}

let nextKey = 0;

/** The live camera. It reports each barcode it reads; if it can't open, the parent shows the typing fallback. */
function CameraView({
  onCode,
  onFail,
  onReady,
}: {
  onCode: (code: string) => void;
  onFail: () => void;
  onReady: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // The latest callbacks, so the camera isn't restarted when the parent re-renders.
  const callbacks = useRef({ onCode, onFail, onReady });
  useEffect(() => {
    callbacks.current = { onCode, onFail, onReady };
  });

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    startCameraScan(video.current!, (code) => callbacks.current.onCode(code)).then(
      (stopper) => {
        if (cancelled) stopper();
        else {
          stop = stopper;
          callbacks.current.onReady();
        }
      },
      () => {
        if (!cancelled) callbacks.current.onFail();
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <video
      ref={video}
      playsInline
      muted
      aria-label={cameraCopy.cameraLabel}
      className="aspect-[4/3] w-full rounded-card bg-ink object-cover"
    />
  );
}

/**
 * The camera screen on Add Food. "Scan barcode" reads codes live (and by typing the number), "Take photo"
 * names the food from a picture. Each find joins a list, so a whole shop can be scanned in a row.
 * Without a camera, or without permission, it says so and the number can still be typed.
 */
export function CameraScreen({ onDone, onClose }: Props) {
  const photoEnabled = useAiStore((s) => s.status?.photoCheck ?? false);
  const loadAi = useAiStore((s) => s.load);
  const [mode, setMode] = useState<Mode>('barcode');
  const [items, setItems] = useState<ScannedItem[]>([]);
  // In the apps the scanner is the system's (ML Kit), opened with a button; in a browser it is the live camera view.
  const nativeScan = platform.barcode.native;
  const [camera, setCamera] = useState<'starting' | 'on' | 'unavailable'>(
    !nativeScan && cameraSupported() ? 'starting' : 'unavailable',
  );
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadAi();
  }, [loadAi]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = (item: Omit<ScannedItem, 'key'>) => {
    setItems((prev) => [...prev, { ...item, key: nextKey++ }]);
    setMessage(cameraCopy.added(item.name));
  };

  /** A barcode: from the camera (`typed` false: anything unreadable is ignored) or typed in. */
  const lookUp = useCallback(async (raw: string, typed: boolean) => {
    const code = cleanBarcode(raw);
    if (!isValidBarcode(code)) {
      if (typed) setError(MESSAGES.barcode);
      return;
    }
    const now = Date.now();
    // The camera sees the same barcode many times a second: one look-up per code, and not again for a few seconds.
    if (working.current || (!typed && lastCode.current?.code === code && now - lastCode.current.at < 5000)) return;
    lastCode.current = { code, at: now };
    working.current = true;
    setError(undefined);
    setMessage(null);
    setBusy(true);
    try {
      const product = await api.lookupBarcode(code);
      if (product.found && product.name) {
        add({
          name: product.name,
          from: 'barcode',
          brand: product.brand,
          ...(product.quantity !== null && product.unit !== null && { quantity: product.quantity, unit: product.unit }),
        });
        if (typed) setDigits('');
      } else setMessage(cameraCopy.notFound);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : cameraCopy.lookupError);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  /** Opens the native scanner. Closing it is fine; a refused camera falls back to typing the number. */
  async function scanNatively() {
    setMessage(null);
    setError(undefined);
    try {
      const code = await platform.barcode.scan();
      if (code) await lookUp(code, true);
    } catch {
      setMessage(cameraCopy.unavailable);
    }
  }

  function submitNumber(e: FormEvent) {
    e.preventDefault();
    void lookUp(digits, true);
  }

  /** A photo: scaled in the browser, named by the AI, and kept to save with the food. */
  async function readPhoto(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const { blob, ...upload } = await photoForUpload(file);
      const result = await api.checkPhoto(upload);
      if (result.confidence < PHOTO_CONFIDENCE_MIN) {
        setMessage(cameraCopy.unsure);
        return;
      }
      add({
        name: result.name,
        category: result.category,
        from: 'photo',
        photo: blob,
        ...(result.warningSigns.length > 0 && { signs: result.warningSigns.map((sign) => sign.description) }),
      });
    } catch (err) {
      setMessage(err instanceof ApiError || err instanceof Error ? err.message : cameraCopy.photoError);
    } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => {
        setMode(value);
        setMessage(null);
        setError(undefined);
      }}
      className={`min-h-12 rounded-button border px-3 text-base font-semibold ${
        mode === value ? 'border-brand bg-brand text-on-brand' : 'border-line bg-card text-ink hover:border-brand/50'
      }`}
    >
      {label}
    </button>
  );

  // Shown through a portal so it covers the whole page, including the navigation bar.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={cameraCopy.title}
      className="fixed inset-0 z-50 overflow-y-auto bg-paper"
    >
      <div className="top-inset mx-auto max-w-xl space-y-4 px-4 pt-4 pb-10">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold tracking-tight">{cameraCopy.title}</h2>
          <Button variant="ghost" onClick={onClose}>
            {cameraCopy.close}
          </Button>
        </header>

        {photoEnabled && (
          <div role="tablist" aria-label={cameraCopy.modes} className="grid grid-cols-2 gap-2">
            {tab('barcode', cameraCopy.barcodeTab)}
            {tab('photo', cameraCopy.photoTab)}
          </div>
        )}

        {mode === 'barcode' && (
          <section aria-label={cameraCopy.barcodeTab} className="space-y-3">
            {nativeScan && (
              <>
                <Button disabled={busy} onClick={() => void scanNatively()}>
                  {cameraCopy.scanButton}
                </Button>
                <p className="text-sm text-muted">{cameraCopy.scanHint}</p>
              </>
            )}
            {camera !== 'unavailable' && (
              <>
                <CameraView
                  onCode={(code) => void lookUp(code, false)}
                  onFail={() => setCamera('unavailable')}
                  onReady={() => setCamera('on')}
                />
                <p className="text-sm text-muted">
                  {camera === 'starting' ? cameraCopy.starting : cameraCopy.pointCamera}
                </p>
              </>
            )}
            {!nativeScan && camera === 'unavailable' && (
              <p role="status" className="rounded-button bg-calm px-3.5 py-3 text-sm text-calm-ink">
                {cameraCopy.unavailable}
              </p>
            )}
            <form onSubmit={submitNumber} className="space-y-3" noValidate>
              <Field
                label={cameraCopy.numberLabel}
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 4006381333931"
                hint={cameraCopy.numberHint}
                value={digits}
                onChange={(e) => {
                  setDigits(e.target.value);
                  setError(undefined);
                }}
                error={error}
              />
              <Button type="submit" variant="secondary" disabled={busy || digits.trim() === ''}>
                {busy ? cameraCopy.looking : cameraCopy.lookUp}
              </Button>
            </form>
          </section>
        )}

        {mode === 'photo' && photoEnabled && (
          <section aria-label={cameraCopy.photoTab} className="space-y-3">
            <p className="text-sm text-muted">{cameraCopy.photoHint}</p>
            {/* "capture" opens the camera on a phone, including an iPhone; on a computer it opens a file chooser. */}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              aria-label={cameraCopy.photoLabel}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readPhoto(file);
              }}
            />
            <Button disabled={busy} onClick={() => void pickPhoto(photoInput.current, readPhoto)}>
              {busy ? cameraCopy.reading : cameraCopy.takePhoto}
            </Button>
          </section>
        )}

        {busy && <Spinner label={mode === 'photo' ? cameraCopy.reading : cameraCopy.looking} />}
        {message && (
          <p role="status" className="rounded-button bg-calm px-3.5 py-3 text-sm text-calm-ink">
            {message}
          </p>
        )}

        {items.length > 0 && (
          <section aria-labelledby="scanned-title" className="space-y-3">
            <h3 id="scanned-title" className="text-base font-semibold">
              {cameraCopy.trayTitle}
            </h3>
            <Card as="ul" className="divide-y divide-line overflow-hidden">
              {items.map((item) => (
                <li key={item.key} className="space-y-1 px-3 py-2">
                  <div className="flex items-center gap-3">
                    {item.photo && (
                      <BlobThumb
                        blob={item.photo}
                        alt={`Photo of ${item.name}`}
                        className="size-12 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{item.name}</p>
                      <p className="truncate text-sm text-muted">
                        {[
                          item.quantity !== undefined && item.unit ? formatQuantity(item.quantity, item.unit) : null,
                          item.brand ?? item.category,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={cameraCopy.remove(item.name)}
                      onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                      className="grid size-12 shrink-0 place-items-center rounded-full text-muted hover:bg-paper"
                    >
                      <X aria-hidden className="size-5" />
                    </button>
                  </div>
                  {item.signs && (
                    <p className="rounded-button bg-soon px-3 py-2 text-sm text-soon-ink">
                      {photoCopy.signs(item.signs)}
                    </p>
                  )}
                </li>
              ))}
            </Card>
            <Button className="w-full" onClick={() => onDone(items)}>
              {items.length === 1 ? cameraCopy.useOne : cameraCopy.useMany(items.length)}
            </Button>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
