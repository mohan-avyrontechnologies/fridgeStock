import { isUsablePrintedDate, parsePrintedDate, type PrintedDateInput, type PrintedDateRead } from '@cook-first/shared';
import { aiPrompts } from '../copy.js';
import type { UserDoc } from '../models/User.js';
import * as aiService from './aiService.js';
import { printedDateJsonSchema, printedDateOutput } from './aiOutputs.js';
import { clock } from './clock.js';

/**
 * Reads the date printed on a pack from a photo. The AI only copies the text and says what the date is
 * called; the server turns the text into a calendar date (day/month order from the person's locale) and
 * drops a date that is more than 2 years away or more than 30 days past. The photo is used for this
 * request alone (never stored or logged) and counts toward the daily AI allowance. Nothing is saved:
 * the person can skip the step, or type the date themselves, and the app works the same without AI.
 */
export async function readPrintedDate(user: UserDoc, input: PrintedDateInput): Promise<PrintedDateRead> {
  const today = clock.today(user.timeZone);
  const result = await aiService.generate(user, {
    system: aiPrompts.dateSystem,
    prompt: aiPrompts.date(),
    images: [{ mediaType: input.mediaType, base64: input.image }],
    schema: printedDateJsonSchema,
    output: printedDateOutput,
    // The copied text is a date, not prose; there is nothing here to check for wording.
    texts: () => [],
    maxTokens: 200,
    tier: 'fast',
  });

  const parsed = parsePrintedDate(result.text, input.locale);
  const printedDate = parsed && isUsablePrintedDate(parsed, today) ? parsed : null;
  return { text: result.text, printedDate, printedDateType: printedDate ? result.kind : 'UNKNOWN' };
}
