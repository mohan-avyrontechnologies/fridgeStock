import type { PrintedDateType, StorageLocation } from './enums.js';

/**
 * The sentences estimateExpiry returns. Like the two copy.ts files, this is a copy file: it is the only place
 * in the shared package that words an expected expiry, and the food-safety guard treats it as one. Every
 * sentence says "expected expiry" and none says whether food is fit to eat.
 */

/** The explanation for an expected expiry the person set themselves. */
export const USER_EXPLANATION = 'You set this expected expiry.';

const printedWords: Record<PrintedDateType, string> = {
  USE_BY: 'a use-by date',
  BEST_BEFORE: 'a best-before date',
  EXPIRY: 'an expiry date',
  UNKNOWN: 'a date',
};

const dayWord = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;
const place = (storage: StorageLocation) => storage.toLowerCase();

export const estimateCopy = {
  printed: (type: PrintedDateType) => `The expected expiry is the date printed on the pack (${printedWords[type]}).`,
  learned: (name: string, days: number, storage: StorageLocation) =>
    `Your ${name.toLowerCase()} usually lasts ${dayWord(days)} in the ${place(storage)}, so that is the expected expiry.`,
  catalog: (name: string, days: number, storage: StorageLocation) =>
    `Catalog: ${name.toLowerCase()} lasts about ${dayWord(days)} in the ${place(storage)}.`,
  catalogOpened: (name: string, days: number) =>
    `Catalog: ${name.toLowerCase()} lasts about ${dayWord(days)} once opened.`,
  category: (days: number, storage: StorageLocation) =>
    `No exact match, so the expected expiry uses the usual ${dayWord(days)} for this kind of food in the ${place(storage)}.`,
  fallback: (days: number) =>
    `Rough estimate: no matching information, so the expected expiry is ${dayWord(days)} after adding.`,
};
