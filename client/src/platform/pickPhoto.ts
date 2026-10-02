import { platform } from './index';

/**
 * Opens the camera (or photo chooser) for one photo and hands it to `onFile`.
 *
 * In a browser that is the screen's own `<input type="file" capture>`, clicked here, so everything the screen
 * did before is unchanged. In the apps the system camera plugin does it and the input is not used.
 */
export async function pickPhoto(input: HTMLInputElement | null, onFile: (file: File) => void): Promise<void> {
  if (!platform.camera.native) {
    input?.click();
    return;
  }
  const file = await platform.camera.takePhoto();
  if (file) onFile(file);
}
