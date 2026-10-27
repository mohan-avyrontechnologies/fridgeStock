import { hasBannedWording, type ProductLookup, type Unit } from '@fridgestock/shared';
import { AppError } from './errors.js';
import { productClient, type RawProduct } from './productClient.js';

/** The longest food name the app accepts. */
const NAME_MAX = 60;

/** The database's unit spellings, as an app unit and the factor to convert to it. */
const UNITS: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: 'g', factor: 1 },
  kg: { unit: 'kg', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'l', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  dl: { unit: 'ml', factor: 100 },
};

function packSize(product: RawProduct): Pick<ProductLookup, 'quantity' | 'unit'> {
  const unit = UNITS[(product.quantityUnit ?? '').toLowerCase()];
  if (!unit || product.quantity === null) return { quantity: null, unit: null };
  const quantity = Math.round(product.quantity * unit.factor * 1000) / 1000;
  return { quantity, unit: unit.unit };
}

/** The first brand, tidied: the database lists several, comma separated. */
const firstBrand = (brands: string | null) => brands?.split(',')[0]?.trim() || null;

const notFound = (barcode: string): ProductLookup => ({
  found: false,
  barcode,
  name: null,
  brand: null,
  quantity: null,
  unit: null,
});

/**
 * Looks a barcode up in the product database. Not being in it is a normal
 * answer (`found: false`), not an error. A product whose name would break the
 * app's wording rules is treated as not found, so such text is never shown.
 */
export async function lookupBarcode(barcode: string): Promise<ProductLookup> {
  let product: RawProduct | null;
  try {
    product = await productClient().lookup(barcode);
  } catch (error) {
    console.error('Product lookup failed', error instanceof Error ? error.message : error);
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Product lookup isn’t available right now. Type the name instead.');
  }
  const name = product?.name?.slice(0, NAME_MAX).trim();
  if (!product || !name || hasBannedWording(name)) return notFound(barcode);
  return { found: true, barcode, name, brand: firstBrand(product.brands), ...packSize(product) };
}
