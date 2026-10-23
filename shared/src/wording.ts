import bannedPhrases from '../data/banned-phrases.json' with { type: 'json' };

/**
 * The food-safety boundary as data: phrases that may never appear in anything
 * the app shows, including AI-generated text. The app only ever talks about an
 * "expected expiry", an estimate for planning. The list lives in
 * shared/data/banned-phrases.json, which the Python server reads too.
 */
export const BANNED_PHRASES: readonly string[] = bannedPhrases.phrases;

const SAFE_WORD = new RegExp(bannedPhrases.safeWordPattern);

/**
 * True if the text uses a banned phrase or calls anything "safe". Used to
 * reject AI output (which is then retried); stricter than the source-code
 * guard because generated text can't be reviewed before it is shown.
 */
export function hasBannedWording(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase)) || SAFE_WORD.test(lower);
}
