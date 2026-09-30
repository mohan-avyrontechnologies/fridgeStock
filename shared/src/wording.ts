/**
 * The food-safety boundary as data: phrases that may never appear in anything
 * the app shows, including AI-generated text. The app only ever talks about an
 * "expected expiry", an estimate for planning.
 */
export const BANNED_PHRASES = [
  'safe until',
  'safe to eat',
  'safe to consume',
  'fresh until',
  'good until',
  'still good',
  'guaranteed',
] as const;

/**
 * True if the text uses a banned phrase or calls anything "safe". Used to
 * reject AI output (which is then retried); stricter than the source-code
 * guard because generated text can't be reviewed before it is shown.
 */
export function hasBannedWording(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase)) || /\bsafe(ly|ty)?\b/.test(lower);
}
