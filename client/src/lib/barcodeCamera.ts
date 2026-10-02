/**
 * Reading a barcode from the camera uses the browser's own BarcodeDetector,
 * which Chrome on Android and desktop provide. Safari and Firefox don't, so the
 * scanner always offers typing the number as well.
 */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ['ean_13', 'ean_8', 'upc_a'];

const detectorClass = (): BarcodeDetectorConstructor | undefined =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;

export function cameraScanSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(detectorClass());
}

/**
 * Starts the rear camera in `video` and calls `onCode` with each barcode number it reads
 * (about four times a second). Returns a function that stops the camera.
 * Rejects if the camera can't be opened (no permission, no camera).
 */
export async function startCameraScan(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const Detector = detectorClass();
  if (!Detector) throw new Error('Barcode reading isn’t supported in this browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  await video.play().catch(() => {});
  const detector = new Detector({ formats: FORMATS });
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped || video.readyState < 2) return;
    try {
      const [found] = await detector.detect(video);
      if (found && !stopped) onCode(found.rawValue);
    } catch {
      // A frame that can't be read is skipped.
    }
  }, 250);
  return () => {
    stopped = true;
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}
