import { describe, expect, it } from 'vitest';
import { cleanBarcode, isValidBarcode } from './barcode.js';

describe('barcodes', () => {
  it('accepts real EAN-13, UPC-A and EAN-8 numbers', () => {
    expect(isValidBarcode('4006381333931')).toBe(true);
    expect(isValidBarcode('036000291452')).toBe(true);
    expect(isValidBarcode('96385074')).toBe(true);
    expect(isValidBarcode('00012345678905')).toBe(true); // GTIN-14
  });

  it('rejects a wrong check digit', () => {
    expect(isValidBarcode('4006381333932')).toBe(false);
    expect(isValidBarcode('036000291453')).toBe(false);
    expect(isValidBarcode('96385075')).toBe(false);
  });

  it('rejects anything that is not 8, 12, 13 or 14 digits', () => {
    for (const code of ['', '1234567', '123456789', '12345678901', '123456789012345', 'abcdefgh', '4006381 33393']) {
      expect(isValidBarcode(code), code).toBe(false);
    }
  });

  it('tidies typed input: spaces and dashes go', () => {
    expect(cleanBarcode(' 4006 3813-33931 ')).toBe('4006381333931');
    expect(isValidBarcode(cleanBarcode('4006 3813 33931'))).toBe(true);
  });
});
