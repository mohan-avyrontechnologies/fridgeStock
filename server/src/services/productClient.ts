import { env } from '../config/env.js';

/** What a product database knows about a barcode, before the app tidies it. */
export interface RawProduct {
  name: string | null;
  brands: string | null;
  /** The pack size as a number, with its unit as the database spells it ("g", "ml", "cl"…). */
  quantity: number | null;
  quantityUnit: string | null;
}

/**
 * The only way the app looks up a barcode. Services depend on this interface
 * and every test uses a fake one, so no test reaches the internet. Resolves
 * null when the product is not in the database; rejects when it can't be reached.
 */
export interface ProductClient {
  lookup(barcode: string): Promise<RawProduct | null>;
}

const TIMEOUT_MS = 5000;
/** Open Food Facts asks every app to say who it is. */
const USER_AGENT = 'CookFirst/2.12 (home food planner)';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const positive = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Open Food Facts: a free, open product database. Needs no key. */
export function createOpenFoodFactsClient(baseUrl: string, fetchFn: typeof fetch = fetch): ProductClient {
  return {
    async lookup(barcode) {
      const fields = 'product_name,brands,product_quantity,product_quantity_unit';
      const url = `${baseUrl.replace(/\/$/, '')}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`;
      const res = await fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Product lookup failed: ${res.status}`);
      const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
      if (body.status !== 1 || !body.product) return null;
      const p = body.product;
      return {
        name: text(p.product_name),
        brands: text(p.brands),
        quantity: positive(p.product_quantity),
        quantityUnit: text(p.product_quantity_unit),
      };
    },
  };
}

let client: ProductClient = createOpenFoodFactsClient(env.productLookupUrl);

export function productClient(): ProductClient {
  return client;
}

/** Swaps the client (tests use a fake one). */
export function setProductClient(next: ProductClient | null): void {
  client = next ?? createOpenFoodFactsClient(env.productLookupUrl);
}
