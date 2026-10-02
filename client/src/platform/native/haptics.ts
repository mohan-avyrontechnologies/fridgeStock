import type { HapticsPlatform } from '../types';

/**
 * The phone's haptic feedback, through @capacitor/haptics (loaded when first needed): a light success tap
 * for a completed action and a warning tap when food is marked as wasted. Never throws: a phone without a
 * haptic engine simply does nothing.
 */
const tap = (kind: 'Success' | 'Warning') => {
  void import('@capacitor/haptics')
    .then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType[kind] }))
    .catch(() => {});
};

export const nativeHaptics: HapticsPlatform = {
  success: () => tap('Success'),
  warning: () => tap('Warning'),
};
