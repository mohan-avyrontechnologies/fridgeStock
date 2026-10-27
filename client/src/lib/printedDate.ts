import { isUsablePrintedDate, parsePrintedDate, type DateString, type PrintedDateType } from '@fridgestock/shared';

/**
 * Reading the date printed on a pack, on the device. It needs no AI and no network: the text comes from the
 * browser's own text detector when it has one (or the person types it), and the shared parsePrintedDate turns
 * it into a date using the person's locale. The AI date reader (POST /parse/date) is only an extra.
 */

/** What a date on a pack is called, from the words around it ("USE BY", "BBE", "EXP"…). */
export function kindFromText(text: string): PrintedDateType {
  const lower = text.toLowerCase();
  if (/\buse[\s-]*by\b/.test(lower)) return 'USE_BY';
  if (/\bbest[\s-]*(before|by)\b|\bbbe\b|\bbb\b|\bbest\s*end\b/.test(lower)) return 'BEST_BEFORE';
  if (/\bexp(iry|ires|\.|\b)/.test(lower)) return 'EXPIRY';
  return 'UNKNOWN';
}

/** Date-shaped pieces of a line of text: numbers with separators, "5 NOV 2026", "NOV 5 2026", "11/2026". */
const DATE_SHAPES = [
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
  /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g,
  /\d{1,2}\s?[A-Za-z]{3,9}\.?,?\s?(?:\d{4}|\d{2})\b/g,
  /[A-Za-z]{3,9}\.?\s?\d{1,2}(?:st|nd|rd|th)?,?\s?(?:\d{4}|\d{2})\b/g,
  /(?<![\d/.-])\d{1,2}[-/.]\d{4}(?![\d/.-])/g,
];

export interface FoundDate {
  /** The text as it was read. */
  text: string;
  date: DateString;
  kind: PrintedDateType;
}

/**
 * The best usable date in lines of text read off a pack. A date with a label ("USE BY 05/11/26", or the label on
 * the line above) wins; otherwise the first usable date does. Dates out of range (more than 2 years away or more
 * than 30 days past) are ignored, and so are batch codes, which are not dates.
 */
export function findPrintedDate(
  lines: readonly string[],
  locale: string | null | undefined,
  today: DateString,
): FoundDate | null {
  const found: FoundDate[] = [];
  lines.forEach((line, index) => {
    for (const shape of DATE_SHAPES) {
      for (const match of line.matchAll(shape)) {
        const text = match[0].trim();
        const date = parsePrintedDate(text, locale);
        if (!date || !isUsablePrintedDate(date, today)) continue;
        if (found.some((f) => f.date === date)) continue;
        const kind =
          [kindFromText(line), kindFromText(lines[index - 1] ?? '')].find((k) => k !== 'UNKNOWN') ?? 'UNKNOWN';
        found.push({ text, date, kind });
      }
    }
  });
  return found.find((f) => f.kind !== 'UNKNOWN') ?? found[0] ?? null;
}

/** The browser's text detector (the Shape Detection API), where there is one. */
interface TextDetectorLike {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
type TextDetectorCtor = new () => TextDetectorLike;

export function onDeviceTextSupported(): boolean {
  return typeof window !== 'undefined' && 'TextDetector' in window;
}

/** Lines of text in a photo, read on the device, or null when this device can't do it. */
export async function readTextOnDevice(photo: Blob): Promise<string[] | null> {
  if (!onDeviceTextSupported()) return null;
  try {
    const Detector = (window as unknown as { TextDetector: TextDetectorCtor }).TextDetector;
    const bitmap = await createImageBitmap(photo);
    try {
      const blocks = await new Detector().detect(bitmap);
      return blocks
        .flatMap((block) => block.rawValue.split(/\r?\n/))
        .map((line) => line.trim())
        .filter(Boolean);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** The person's locale, for day/month order. */
export const userLocale = (): string | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator.languages?.[0] ?? navigator.language);
