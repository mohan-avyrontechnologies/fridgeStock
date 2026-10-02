import { Capacitor } from '@capacitor/core';
import type { BarcodePlatform } from '../types';

/**
 * Barcodes in the app are read by ML Kit (through @capacitor-mlkit/barcode-scanning), which opens its own
 * scanner over the app. It reads the grocery formats only: EAN-13, EAN-8 and UPC-A.
 */
export const nativeBarcode: BarcodePlatform = {
  native: true,
  async scan() {
    const { BarcodeScanner, BarcodeFormat, GoogleBarcodeScannerModuleInstallState } =
      await import('@capacitor-mlkit/barcode-scanning');

    const permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      throw new Error('Camera permission was refused.');
    }

    // On Android the scanner is a module from Google Play services, downloaded the first time.
    if (Capacitor.getPlatform() === 'android') {
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        await new Promise<void>((resolve, reject) => {
          void BarcodeScanner.addListener('googleBarcodeScannerModuleInstallProgress', (event) => {
            if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) resolve();
            else if (
              event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
              event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
            ) {
              reject(new Error('The scanner could not be installed.'));
            }
          });
          BarcodeScanner.installGoogleBarcodeScannerModule().catch(reject);
        }).finally(() => void BarcodeScanner.removeAllListeners());
      }
    }

    try {
      const { barcodes } = await BarcodeScanner.scan({
        formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA],
      });
      return barcodes[0]?.rawValue ?? null;
    } catch (error) {
      // Closing the scanner without reading anything is not an error.
      if (/cancel/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
  },
};
