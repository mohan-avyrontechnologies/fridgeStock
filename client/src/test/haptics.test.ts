import { describe, expect, it, vi } from 'vitest';

/** Haptic taps: the apps use Capacitor Haptics; a browser does nothing. */

const haptics = vi.hoisted(() => ({ notification: vi.fn(async () => {}) }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: haptics,
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

describe('haptics', () => {
  it('on a phone, completed actions give a success tap and wasting gives a warning tap', async () => {
    const { nativeHaptics } = await import('../platform/native/haptics');
    nativeHaptics.success();
    await vi.waitFor(() => expect(haptics.notification).toHaveBeenCalledTimes(1));
    nativeHaptics.warning();
    await vi.waitFor(() => expect(haptics.notification).toHaveBeenCalledTimes(2));
    expect(haptics.notification.mock.calls).toEqual([[{ type: 'SUCCESS' }], [{ type: 'WARNING' }]]);
  });

  it('never throws, even when the phone has no haptic engine', async () => {
    haptics.notification.mockRejectedValueOnce(new Error('unavailable'));
    const { nativeHaptics } = await import('../platform/native/haptics');
    expect(() => nativeHaptics.success()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('in a browser they do nothing', async () => {
    haptics.notification.mockClear();
    const { webHaptics } = await import('../platform/web');
    webHaptics.success();
    webHaptics.warning();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(haptics.notification).not.toHaveBeenCalled();
  });

  it('the native platform has them, and the Haptics plugin is a dependency of the app', async () => {
    const { createNativePlatform } = await import('../platform/native');
    expect(createNativePlatform('ios').haptics).toBeDefined();
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync('package.json', 'utf8')).dependencies['@capacitor/haptics']).toBeDefined();
  });
});
