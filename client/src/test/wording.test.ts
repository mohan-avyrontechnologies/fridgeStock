import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as copy from '../copy';
import { describeError } from '../lib/errors';
import { ApiError } from '../api/client';

/**
 * Wording rules for everything the interface says: sentence case, one name for each action from its button to
 * its toast, and error messages that say what happened and what to do. (The food-safety wording rules are
 * checked separately, by the banned-phrase scan in the server tests.)
 */

/** Every piece of text in the copy file, with the functions called on sample values. */
function strings(value: unknown, trail = 'copy'): { at: string; text: string }[] {
  if (typeof value === 'string') return [{ at: trail, text: value }];
  if (typeof value === 'function') {
    // Try sample values of the kinds the copy functions take: names and dates, a list of names, or numbers.
    const samples: unknown[][] = [['spinach', 'fridge', 'tue 3 oct'], [['spinach', 'milk']], [3], [2, 5]];
    for (const sample of samples) {
      try {
        const call = (value as (...args: unknown[]) => unknown)(...sample);
        if (typeof call === 'string') return [{ at: `${trail}()`, text: call }];
      } catch {
        // Wrong kind of sample for this one: try the next.
      }
    }
    return [];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${trail}.${key}`));
  }
  return [];
}

const ALL = Object.entries(copy).flatMap(([name, value]) => strings(value, name));

/** Names that are always capitalised, wherever they come in a sentence. */
const NAMES = [
  'Cook First',
  'Home Screen',
  'Share',
  'Open Food Facts',
  'Add to Home Screen',
  'Home',
  'Settings',
  'History',
  'Insights',
  'Household',
  'Shopping',
  'Meal plan',
];

/** Replaces the names that are always capitalised, so they don't count. */
const withoutNames = (text: string) => NAMES.reduce((rest, name) => rest.split(name).join('·'), text);

/** Other proper nouns that may be capitalised mid-sentence. */
const PROPER = ['Android', 'iPhone', 'Share', 'Safari', 'Chrome', 'Claude', 'Anthropic', 'AI'];

describe('sentence case', () => {
  it('has no run of capitalised words in any text (apart from names), such as "See History" or "Add Food"', () => {
    const bad = ALL.flatMap(({ at, text }) => {
      const hit = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.exec(withoutNames(text));
      return hit ? [`${at}: "${hit[0]}"`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('does not capitalise words in the middle of a sentence, apart from names', () => {
    const bad = ALL.flatMap(({ at, text }) => {
      const hit = /[a-z,] ([A-Z][a-z]+)/.exec(withoutNames(text));
      return hit && !PROPER.includes(hit[1]!) ? [`${at}: "${hit[0]}"`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('starts every sentence with a capital letter, and has no word in capitals', () => {
    const shouting = ALL.filter(
      ({ text }) => /\b[A-Z]{4,}\b/.test(text) && !/\b(AI|FAQ|USD|EUR|GBP|CAD|AUD|INR)\b/.test(text),
    );
    expect(shouting.map((s) => s.at)).toEqual([]);
  });

  it('does not style any text in capitals with CSS either', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? (name === 'test' ? [] : files(full)) : /\.tsx$/.test(name) ? [full] : [];
      });
    const offenders = files(path.resolve('src')).filter((file) =>
      /\b(uppercase|capitalize)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('one name for each action, from its button to its toast', () => {
  const { actionCopy, swipeCopy, openCopy, moveCopy, favouriteCopy } = copy;

  it('"Mark as used" leads to "Marked as used", and the same for wasted', () => {
    expect(swipeCopy.used).toBe('Mark as used');
    expect(actionCopy.USED.past).toBe('Marked as used');
    expect(swipeCopy.wasted).toBe('Mark as wasted');
    expect(actionCopy.WASTED.past).toBe('Marked as wasted');
  });

  it('every action button starts with a plain verb and its toast is that verb in the past', () => {
    expect(actionCopy.USED.label).toBe('Mark all as used');
    expect(actionCopy.PARTIALLY_USED.label).toBe('Mark some as used');
    expect(actionCopy.PARTIALLY_USED.past).toBe('Marked some as used');
    expect(actionCopy.REMOVED).toEqual({ label: 'Remove', past: 'Removed' });
    expect(openCopy.button).toBe('Mark as opened');
    expect(openCopy.toast('Milk', '3 Oct')).toMatch(/^Marked Milk as opened\./);
    expect(moveCopy.button).toBe('Move');
    expect(moveCopy.toast('Milk', 'Freezer', '3 Oct')).toMatch(/^Moved Milk to the freezer\./);
    expect(favouriteCopy.save).toBe('Save as favourite');
    expect(favouriteCopy.savedToast('Milk')).toBe('Saved Milk as a favourite');
  });

  it('adding food is "Add food" on the button and "Added" in the toast, and editing is "Save changes" then "Saved changes"', () => {
    expect(copy.homeCopy.addFood).toBe('Add food');
    expect(copy.favouriteCopy.addedToast('Milk')).toBe('Added Milk');
    expect(copy.screenCopy.detail.savedToast).toMatch(/^Saved changes\./);
  });
});

describe('error messages', () => {
  const what = 'save that';
  const messages = [
    describeError(new ApiError(0, 'NETWORK', 'x'), what),
    describeError(new ApiError(401, 'UNAUTHENTICATED', 'x'), what),
    describeError(new ApiError(500, 'SERVER', 'x'), what),
    describeError(new ApiError(503, 'AI_UNAVAILABLE', 'x'), what),
    describeError(new Error('boom'), what),
    describeError('weird', what),
  ];

  it('say what happened, in plain words, and what to do about it', () => {
    for (const message of messages) {
      expect(message, message).toMatch(/^Couldn’t save that/);
      expect(message, message).toMatch(/Check your internet|Sign in again|Try again|Wait a minute|reload the page/);
    }
  });

  it('never blame the person, use jargon, or just say "something went wrong"', () => {
    for (const message of messages) {
      expect(message).not.toMatch(/something went wrong|error code|exception|undefined|null|stack/i);
      expect(message).not.toMatch(/\b(you|your) (failed|mistake|fault)\b/i);
    }
  });

  it('tell different problems apart: no connection, signed out, a server problem, and anything else', () => {
    expect(new Set(messages.slice(0, 3)).size).toBe(3);
    expect(messages[0]).toMatch(/no connection/);
    expect(messages[1]).toMatch(/signed out/);
    expect(messages[2]).toMatch(/Cook First had a problem/);
  });

  it('show the server’s own reason when it explains a mistake (such as a wrong password), and not for a session that ended', () => {
    expect(describeError(new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'), 'sign in')).toBe(
      'Email or password is incorrect.',
    );
    expect(describeError(new ApiError(400, 'VALIDATION_ERROR', 'Enter a food name.'), what)).toBe('Enter a food name.');
    expect(describeError(new ApiError(429, 'RATE_LIMITED', 'You’ve used all 20 AI suggestions for today.'), what)).toBe(
      'You’ve used all 20 AI suggestions for today.',
    );
  });

  it('every load error in the copy file says what could not be loaded', () => {
    const loads = ALL.filter(({ at }) => /loadError$/.test(at));
    expect(loads.length).toBeGreaterThan(5);
    for (const { text } of loads) expect(text).toMatch(/^Couldn’t load /);
  });
});

describe('plain, friendly wording', () => {
  it('uses typographic apostrophes, never the straight one, in sentences', () => {
    const straight = ALL.filter(({ text }) => /[a-z]'[a-z]/.test(text));
    expect(straight.map((s) => s.at)).toEqual([]);
  });
});
