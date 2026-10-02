/**
 * Reading a barcode from the camera. The browser's own BarcodeDetector is used where it exists (Chrome on
 * Android and some desktops); everywhere else, such as Safari on an iPhone, @zxing/browser reads the video
 * instead (loaded only when it is needed, as it is large). Either way a code is only reported when it has
 * the right length, and the person can always type the number instead.
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

/** True when the browser can open a camera at all (a secure page with `getUserMedia`). */
export function cameraSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Reads with the browser's detector, about four times a second, from a stream we opened. */
async function scanWithDetector(
  Detector: BarcodeDetectorConstructor,
  video: HTMLVideoElement,
  onCode: (code: string) => void,
): Promise<() => void> {
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

/** Reads with @zxing/browser, which decodes the video itself and opens the rear camera. */
async function scanWithZxing(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map<number, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]],
  ]);
  const reader = new BrowserMultiFormatReader(hints);
  let stopped = false;
  const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
    if (result && !stopped) onCode(result.getText());
  });
  return () => {
    stopped = true;
    controls.stop();
  };
}

/**
 * Starts the rear camera in `video` and calls `onCode` with each barcode number it reads.
 * Returns a function that stops the camera. Rejects if the camera can't be opened (no permission, no camera).
 */
export async function startCameraScan(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  if (!cameraSupported()) throw new Error('No camera is available.');
  const Detector = detectorClass();
  return Detector ? scanWithDetector(Detector, video, onCode) : scanWithZxing(video, onCode);
}
