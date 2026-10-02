import { cleanBarcode, isValidBarcode, MESSAGES, type ProductLookup } from '@cook-first/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { scanCopy } from '../copy';
import { cameraScanSupported, startCameraScan } from '../lib/barcodeCamera';
import { Button, Field, Spinner } from './ui';

interface Props {
  /** Called with a product the database knows. The form is filled in from it. */
  onFound: (product: ProductLookup) => void;
  onClose: () => void;
}

/** The camera preview. It reads barcodes until one is found, then stops. */
function CameraView({ onCode, onFail }: { onCode: (code: string) => void; onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  // The latest callbacks, so the camera isn't restarted when the parent re-renders.
  const callbacks = useRef({ onCode, onFail });
  useEffect(() => {
    callbacks.current = { onCode, onFail };
  });

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    startCameraScan(video.current!, (code) => {
      if (isValidBarcode(code)) callbacks.current.onCode(code);
    }).then(
      (stopper) => {
        if (cancelled) stopper();
        else stop = stopper;
      },
      () => callbacks.current.onFail(),
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
      aria-label={scanCopy.cameraLabel}
      className="aspect-[4/3] w-full rounded-2xl bg-ink object-cover"
    />
  );
}

/** Looks a barcode up and hands the product back. Works by typing the number, and by camera where the browser can. */
export function BarcodeScanner({ onFound, onClose }: Props) {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const canScan = cameraScanSupported();

  const lookUp = useCallback(
    async (raw: string) => {
      const code = cleanBarcode(raw);
      setMessage(null);
      if (!isValidBarcode(code)) {
        setError(MESSAGES.barcode);
        return;
      }
      setError(undefined);
      setCamera(false);
      setBusy(true);
      try {
        const product = await api.lookupBarcode(code);
        if (product.found) onFound(product);
        else setMessage(scanCopy.notFound);
      } catch (err) {
        setMessage(err instanceof ApiError ? err.message : scanCopy.lookupError);
      } finally {
        setBusy(false);
      }
    },
    [onFound],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    void lookUp(digits);
  }

  return (
    <section aria-labelledby="scan-title" className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="scan-title" className="text-base font-semibold">
          {scanCopy.title}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {scanCopy.close}
        </Button>
      </div>

      {canScan && !camera && (
        <Button variant="secondary" disabled={busy} onClick={() => setCamera(true)}>
          {scanCopy.useCamera}
        </Button>
      )}
      {camera && (
        <>
          <CameraView
            onCode={lookUp}
            onFail={() => {
              setCamera(false);
              setMessage(scanCopy.cameraFailed);
            }}
          />
          <p className="text-sm text-muted">{scanCopy.pointCamera}</p>
        </>
      )}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field
          label={scanCopy.numberLabel}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 4006381333931"
          hint={scanCopy.numberHint}
          value={digits}
          onChange={(e) => {
            setDigits(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
        <Button type="submit" disabled={busy || digits.trim() === ''}>
          {busy ? scanCopy.looking : scanCopy.lookUp}
        </Button>
      </form>

      {busy && <Spinner label={scanCopy.looking} />}
      {message && (
        <p role="status" className="rounded-xl bg-calm px-3.5 py-3 text-sm text-calm-ink">
          {message}
        </p>
      )}
    </section>
  );
}
