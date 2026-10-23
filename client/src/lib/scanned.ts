import { findReference, usualStorage, type PrintedDateType, type StorageLocation, type Unit } from '@cook-first/shared';

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
  /** A date read off the pack by the date step (on the device, or by the AI), and what it is called. */
  printedDate?: string | null;
  printedDateType?: PrintedDateType | null;
  /** Visible warning signs the AI noticed. They are only shown here; Photo Check on Food Details is where you act on them. */
  signs?: string[];
}

/** What Add Food or a Bulk Add row starts with for a scanned product. */
export interface ScannedFields {
  name: string;
  quantity?: number;
  unit?: Unit;
  notes?: string;
  /** Where the catalog says the food is usually kept. */
  storage?: StorageLocation;
  category?: string;
  printedDate?: string | null;
  printedDateType?: PrintedDateType | null;
}

/**
 * The fields for a scanned product. A food the catalog knows gets the place it is usually kept, for the person
 * to confirm (its expected expiry is estimated, never typed); a pack size from a barcode keeps its own unit.
 */
export function fieldsFor(item: ScannedItem): ScannedFields {
  const reference = findReference(item.name);
  const unit = item.unit ?? reference?.unit;
  return {
    name: item.name,
    ...(item.quantity !== undefined && { quantity: item.quantity }),
    ...(unit && { unit }),
    ...(item.brand && { notes: item.brand }),
    ...(reference && { storage: usualStorage(reference) }),
    ...(item.category && { category: item.category }),
    ...(item.printedDate && { printedDate: item.printedDate, printedDateType: item.printedDateType ?? 'UNKNOWN' }),
  };
}
