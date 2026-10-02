import { MAX_RECEIPT_BASE64, RECEIPT_MAX_SIDE } from '@cook-first/shared';

/** The size an image has after being scaled so its longest side is at most `max` (never enlarged). */
export function scaledSize(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/**
 * Scales a photo down in the browser (longest side RECEIPT_MAX_SIDE) and turns it into
 * JPEG base64 text for the server. A phone photo can be 10 MB; a receipt reads fine at this size.
 * Quality drops a step at a time if the result is still too big to send.
 */
export async function photoForReceipt(file: File): Promise<{ mediaType: 'image/jpeg'; image: string }> {
  // createImageBitmap applies the photo's rotation, so a sideways phone photo comes out upright.
  const bitmap = await createImageBitmap(file);
  const { width, height } = scaledSize(bitmap.width, bitmap.height, RECEIPT_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) break;
    const image = toBase64(new Uint8Array(await blob.arrayBuffer()));
    if (image.length <= MAX_RECEIPT_BASE64) return { mediaType: 'image/jpeg', image };
  }
  throw new Error('That photo is too large. Try a smaller one.');
}
