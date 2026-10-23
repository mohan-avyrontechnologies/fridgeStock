import copy from '../data/estimate-copy.json' with { type: 'json' };
import type { PrintedDateType, StorageLocation } from './enums.js';
import { fillTemplate } from './template.js';

/**
 * The sentences estimateExpiry returns. Like the two copy.ts files, this is a copy file: it is the only place
 * in the shared package that words an expected expiry, and the food-safety guard treats it (and the
 * shared/data/estimate-copy.json it reads, which the Python server reads too) as one. Every sentence says
 * "expected expiry" and none says whether food is fit to eat.
 */

/** The explanation for an expected expiry the person set themselves. */
export const USER_EXPLANATION = copy.userExplanation;

const dayWord = (days: number) => fillTemplate(days === 1 ? copy.days.one : copy.days.other, { n: days });
const place = (storage: StorageLocation) => storage.toLowerCase();

export const estimateCopy = {
  printed: (type: PrintedDateType) => fillTemplate(copy.printed, { printed: copy.printedWords[type] }),
  learned: (name: string, days: number, storage: StorageLocation) =>
    fillTemplate(copy.learned, { name: name.toLowerCase(), days: dayWord(days), storage: place(storage) }),
  catalog: (name: string, days: number, storage: StorageLocation) =>
    fillTemplate(copy.catalog, { name: name.toLowerCase(), days: dayWord(days), storage: place(storage) }),
  catalogOpened: (name: string, days: number) =>
    fillTemplate(copy.catalogOpened, { name: name.toLowerCase(), days: dayWord(days) }),
  category: (days: number, storage: StorageLocation) =>
    fillTemplate(copy.category, { days: dayWord(days), storage: place(storage) }),
  fallback: (days: number) => fillTemplate(copy.fallback, { days: dayWord(days) }),
};
