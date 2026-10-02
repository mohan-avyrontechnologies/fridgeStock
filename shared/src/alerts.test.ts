import { describe, expect, it } from 'vitest';
import {
  alertFor,
  channelFor,
  clockMinutes,
  DEFAULT_ALERTS,
  DEFAULT_MEAL_REMINDERS,
  isQuietHours,
  isUrgent,
  mergesWithDigest,
  minutesInTz,
  soundFor,
  vibrationFor,
} from './alerts.js';
import { MEAL_TYPES, PUSH_KINDS } from './enums.js';

const at = (iso: string) => new Date(iso);
const quiet = DEFAULT_ALERTS.quietHours; // 22:00 to 07:00

describe('clockMinutes', () => {
  it('reads HH:mm and rejects anything else', () => {
    expect(clockMinutes('00:00')).toBe(0);
    expect(clockMinutes('07:30')).toBe(450);
    expect(clockMinutes('23:59')).toBe(1439);
    for (const bad of ['24:00', '7:30', '07:60', '0730', '', 'ab:cd', '07:30:00'])
      expect(clockMinutes(bad), bad).toBeNull();
  });
});

describe('minutesInTz', () => {
  it('is the time of day in that zone', () => {
    expect(minutesInTz('UTC', at('2026-10-03T07:30:00Z'))).toBe(450);
    expect(minutesInTz('Asia/Kolkata', at('2026-10-03T07:30:00Z'))).toBe(13 * 60);
    expect(minutesInTz('Pacific/Kiritimati', at('2026-10-03T12:00:00Z'))).toBe(2 * 60);
    expect(minutesInTz('America/New_York', at('2026-10-03T00:15:00Z'))).toBe(20 * 60 + 15);
  });
});

describe('isQuietHours', () => {
  it('covers 22:00 to 07:00 across midnight, including the start and not the end', () => {
    expect(isQuietHours('UTC', at('2026-10-03T21:59:00Z'), quiet)).toBe(false);
    expect(isQuietHours('UTC', at('2026-10-03T22:00:00Z'), quiet)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-03T23:59:00Z'), quiet)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-04T00:00:00Z'), quiet)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-04T06:59:00Z'), quiet)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-04T07:00:00Z'), quiet)).toBe(false);
    expect(isQuietHours('UTC', at('2026-10-04T12:00:00Z'), quiet)).toBe(false);
  });

  it('uses the person’s time zone, not the server’s', () => {
    const now = at('2026-10-03T17:00:00Z');
    expect(isQuietHours('Asia/Kolkata', now, quiet)).toBe(true); // 22:30
    expect(isQuietHours('America/New_York', now, quiet)).toBe(false); // 13:00
    expect(isQuietHours('Pacific/Auckland', now, quiet)).toBe(true); // 06:00 the next morning
    expect(isQuietHours('Europe/London', now, quiet)).toBe(false); // 18:00
  });

  it('follows daylight saving time', () => {
    // London falls back on 2026-10-25: 21:30Z is 21:30 (GMT) afterwards but was 22:30 (BST) before.
    expect(isQuietHours('Europe/London', at('2026-10-24T21:30:00Z'), quiet)).toBe(true);
    expect(isQuietHours('Europe/London', at('2026-10-25T21:30:00Z'), quiet)).toBe(false);
  });

  it('handles a period inside one day', () => {
    const day = { enabled: true, start: '13:00', end: '15:00' };
    expect(isQuietHours('UTC', at('2026-10-03T12:59:00Z'), day)).toBe(false);
    expect(isQuietHours('UTC', at('2026-10-03T13:00:00Z'), day)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-03T14:59:00Z'), day)).toBe(true);
    expect(isQuietHours('UTC', at('2026-10-03T15:00:00Z'), day)).toBe(false);
  });

  it('is never quiet when switched off, or when the start and end are the same', () => {
    expect(isQuietHours('UTC', at('2026-10-03T23:00:00Z'), { ...quiet, enabled: false })).toBe(false);
    expect(isQuietHours('UTC', at('2026-10-03T23:00:00Z'), { enabled: true, start: '22:00', end: '22:00' })).toBe(
      false,
    );
  });
});

describe('sounds, vibration and channels', () => {
  it('gentle for approaching expiry and the summary, strong for due and overdue, and its own for meals', () => {
    expect(soundFor('APPROACHING_EXPIRY')).toBe('gentle');
    expect(soundFor('DIGEST')).toBe('gentle');
    expect(soundFor('DUE')).toBe('strong');
    expect(soundFor('OVERDUE')).toBe('strong');
    expect(soundFor('MEAL')).toBe('meal');
  });

  it('only due and overdue are urgent, and they vibrate the longest', () => {
    expect(PUSH_KINDS.filter(isUrgent)).toEqual(['DUE', 'OVERDUE']);
    expect(vibrationFor('DUE').length).toBeGreaterThan(vibrationFor('MEAL').length);
    expect(vibrationFor('MEAL').length).toBeGreaterThan(vibrationFor('DIGEST').length);
  });

  it('picks the channel for every kind and every combination of the switches', () => {
    expect(channelFor('APPROACHING_EXPIRY', true, true)).toBe('food-soon');
    expect(channelFor('DIGEST', true, false)).toBe('food-soon');
    expect(channelFor('DUE', true, true)).toBe('food-urgent');
    expect(channelFor('OVERDUE', true, true)).toBe('food-urgent');
    expect(channelFor('DUE', true, false)).toBe('food-urgent-sound');
    expect(channelFor('OVERDUE', false, true)).toBe('reminders-vibrate');
    expect(channelFor('MEAL', true, true)).toBe('meal-reminders');
    expect(channelFor('MEAL', true, false)).toBe('meal-reminders');
    for (const kind of PUSH_KINDS) expect(channelFor(kind, false, false), kind).toBe('reminders-silent');
    expect(channelFor('MEAL', false, true)).toBe('reminders-silent');
  });
});

describe('alertFor', () => {
  it('gives each kind its sound and channel, and keeps due and overdue on screen', () => {
    const expected = {
      APPROACHING_EXPIRY: ['food-soon', 'gentle', false],
      DIGEST: ['food-soon', 'gentle', false],
      DUE: ['food-urgent', 'strong', true],
      OVERDUE: ['food-urgent', 'strong', true],
      MEAL: ['meal-reminders', 'meal', false],
    } as const;
    for (const kind of PUSH_KINDS) {
      const alert = alertFor(kind, DEFAULT_ALERTS, false);
      const [channel, sound, stay] = expected[kind];
      expect(alert, kind).toMatchObject({ channel, sound, requireInteraction: stay, silent: false });
      expect(alert.vibrate.length, kind).toBeGreaterThan(0);
    }
  });

  it('is silent during quiet hours: no sound, no vibration, the silent channel, but it still arrives', () => {
    for (const kind of PUSH_KINDS) {
      expect(alertFor(kind, DEFAULT_ALERTS, true), kind).toMatchObject({
        channel: 'reminders-silent',
        sound: null,
        vibrate: [],
        silent: true,
      });
    }
    // Due and overdue still stay until acted on, even when quiet.
    expect(alertFor('DUE', DEFAULT_ALERTS, true).requireInteraction).toBe(true);
  });

  it('follows the sound switch and the vibration switch separately', () => {
    const noSound = alertFor('DUE', { ...DEFAULT_ALERTS, sound: false }, false);
    expect(noSound).toMatchObject({ sound: null, channel: 'reminders-vibrate', silent: false });
    expect(noSound.vibrate.length).toBeGreaterThan(0);

    const noVibration = alertFor('DUE', { ...DEFAULT_ALERTS, vibration: false }, false);
    expect(noVibration).toMatchObject({ sound: 'strong', vibrate: [], channel: 'food-urgent-sound' });

    const neither = alertFor('MEAL', { ...DEFAULT_ALERTS, sound: false, vibration: false }, false);
    expect(neither).toMatchObject({ sound: null, vibrate: [], channel: 'reminders-silent', silent: true });
  });
});

describe('mergesWithDigest', () => {
  it('is true when a meal reminder is within 30 minutes of the summary, either side, and false beyond', () => {
    expect(mergesWithDigest('07:30', 8)).toBe(true); // exactly 30 before
    expect(mergesWithDigest('08:30', 8)).toBe(true); // exactly 30 after
    expect(mergesWithDigest('08:00', 8)).toBe(true);
    expect(mergesWithDigest('07:29', 8)).toBe(false);
    expect(mergesWithDigest('08:31', 8)).toBe(false);
    expect(mergesWithDigest('12:30', 8)).toBe(false);
  });
});

describe('defaults', () => {
  it('quiet hours are on from 22:00 to 07:00; sound and vibration are on; meals are 07:30, 12:30 and 19:30 (off until chosen)', () => {
    expect(DEFAULT_ALERTS).toEqual({
      sound: true,
      vibration: true,
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });
    expect(MEAL_TYPES.map((meal) => DEFAULT_MEAL_REMINDERS[meal].time)).toEqual(['07:30', '12:30', '19:30']);
    expect(MEAL_TYPES.every((meal) => !DEFAULT_MEAL_REMINDERS[meal].enabled)).toBe(true);
  });
});
