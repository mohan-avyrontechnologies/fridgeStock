import { DEFAULT_ALERTS, isQuietHours, soundFor, type PushKind, type SoundName, type User } from '@fridgestock/shared';

/**
 * The in-app chime: when a reminder arrives while FridgeStock is open, play the matching sound (gentle, strong
 * or meal). The sound files are in client/assets/sounds. A licensed `<sound>.wav` (or .ogg or .mp3) wins over the
 * `<sound>.placeholder.wav` that stands in until it is added.
 *
 * Browsers only allow sound after the person has touched the page, so nothing plays until they have, and it
 * is never played during quiet hours or when sounds are off. No alarms and nothing that rings until dismissed:
 * it is one short sound.
 */

const files = import.meta.glob('../../assets/sounds/*.{wav,ogg,mp3}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** The address of a sound's file: a licensed one if there is one, else the placeholder. */
export function soundUrl(sound: SoundName): string | null {
  const names = Object.keys(files);
  const own = names.find((file) => new RegExp(`/${sound}\\.(wav|ogg|mp3)$`).test(file));
  const stand = names.find((file) => new RegExp(`/${sound}\\.placeholder\\.(wav|ogg|mp3)$`).test(file));
  const chosen = own ?? stand;
  return chosen ? files[chosen]! : null;
}

let interacted = false;
let tracking = false;

/** Starts watching for the first touch, click or key press. Safe to call again. */
export function trackInteraction(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  const events = ['pointerdown', 'keydown', 'touchstart'] as const;
  const mark = () => {
    interacted = true;
    for (const name of events) window.removeEventListener(name, mark);
  };
  for (const name of events) window.addEventListener(name, mark, { passive: true });
}

export const hasInteracted = () => interacted;

/** For tests: forget everything. */
export function resetChime(): void {
  interacted = false;
  tracking = false;
}

/** Whether the chime should play for this reminder kind now, for this person. */
export function shouldChime(user: User | null, now: Date): boolean {
  if (!user || !interacted) return false;
  const alerts = user.alerts ?? DEFAULT_ALERTS;
  return alerts.sound && !isQuietHours(user.timeZone, now, alerts.quietHours);
}

/** Plays the chime for a kind of reminder if it should be played. Resolves true if a sound was started. */
export async function playChime(user: User | null, kind: PushKind, now: Date = new Date()): Promise<boolean> {
  if (!shouldChime(user, now)) return false;
  const url = soundUrl(soundFor(kind));
  if (!url) return false;
  try {
    await new Audio(url).play();
    return true;
  } catch {
    // The browser refused (no touch yet on this page, or no audio): the reminder is still shown.
    return false;
  }
}
