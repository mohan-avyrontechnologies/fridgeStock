/**
 * Product barcodes (GTIN): EAN-8, UPC-A (12), EAN-13 and GTIN-14, all ending in
 * a check digit. Checking it catches a mistyped or misread number before any
 * lookup is made.
 */
export const BARCODE_LENGTHS = [8, 12, 13, 14] as const;

/** True for a number of 8, 12, 13 or 14 digits whose last digit is the correct check digit. */
export function isValidBarcode(code: string): boolean {
  if (!/^\d+$/.test(code) || !(BARCODE_LENGTHS as readonly number[]).includes(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  // From the right, the digit next to the check digit counts three times, then once, and so on.
  const sum = digits.reverse().reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** What people type or scan, tidied: digits only (spaces and dashes are dropped). */
export function cleanBarcode(input: string): string {
  return input.replace(/[\s-]/g, '');
}
