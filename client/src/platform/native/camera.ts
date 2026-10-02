import type { CameraPlatform } from '../types';

/** The photo's longest side is scaled to this by the plugin, so a 12-megapixel photo isn't passed through the web view. */
const MAX_SIDE = 1600;

/**
 * Photos in the app come from the system: @capacitor/camera asks the person to take one or choose one from
 * their photo library. (The iOS Info.plist and the Android manifest explain why access is needed.)
 */
export const nativeCamera: CameraPlatform = {
  native: true,
  async takePhoto() {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Prompt,
        resultType: CameraResultType.Uri,
        quality: 85,
        width: MAX_SIDE,
        height: MAX_SIDE,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!photo.webPath) return null;
      const blob = await (await fetch(photo.webPath)).blob();
      const type = blob.type || `image/${photo.format === 'jpg' ? 'jpeg' : photo.format}`;
      return new File([blob], `photo.${photo.format}`, { type });
    } catch (error) {
      // Closing the camera without taking a photo is not an error.
      if (/cancel/i.test(error instanceof Error ? error.message : String(error))) return null;
      throw error;
    }
  },
};
