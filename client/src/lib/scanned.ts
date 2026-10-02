import type { LearnedLifespan, StorageLocation, Unit } from '@cook-first/shared';
import { firstSuggestion } from './suggestions';

/** One product the camera found, waiting to be put away. */
export interface ScannedItem {
  key: number;
  name: string;
  quantity?: number;
  unit?: Unit;
  /** A brand a barcode look-up found; kept as a note. */
  brand?: string | null;
  /** What the AI called the food's kind, for a photo. */
  category?: string;
  from: 'barcode' | 'photo';
  /** The photo taken (photo mode), kept with the food when it is saved. */
  photo?: Blob;
  /** Visible warning signs the AI noticed. They are only shown here; Photo Check on Food Details is where you act on them. */
  signs?: string[];
}

/** What Add Food or a Bulk Add row starts with for a scanned product. */
export interface ScannedFields {
  name: string;
  quantity?: number;
  unit?: Unit;
  notes?: string;
  /** The usual lifespan and place for a food in the catalog (your own usual first, then the reference list). */
  lifespanDays?: number;
  storage?: StorageLocation;
}

/**
 * The fields for a scanned product. A food the catalog knows gets its usual lifespan and where it is kept,
 * for the person to confirm; a pack size from a barcode keeps its own unit.
 */
export function fieldsFor(item: ScannedItem, learned: LearnedLifespan[]): ScannedFields {
  const suggestion = firstSuggestion(item.name, learned);
  const unit = item.unit ?? suggestion?.unit;
  return {
    name: item.name,
    ...(item.quantity !== undefined && { quantity: item.quantity }),
    ...(unit && { unit }),
    ...(item.brand && { notes: item.brand }),
    ...(suggestion && { lifespanDays: suggestion.days, storage: suggestion.storage }),
  };
}
