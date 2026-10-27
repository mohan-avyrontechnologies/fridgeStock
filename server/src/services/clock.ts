import { todayInTz, type DateString } from '@fridgestock/shared';

/**
 * The server's only source of the current time. Date logic must go through
 * `today(timeZone)`; `now()` is for event timestamps (sentAt, closedAt).
 * Tests pin the time with `set()` instead of faking timers.
 */
let override: Date | null = null;

export const clock = {
  now(): Date {
    return override ? new Date(override) : new Date();
  },
  /** Today's calendar date in the given IANA time zone. */
  today(timeZone: string): DateString {
    return todayInTz(timeZone, clock.now());
  },
  set(date: Date | null): void {
    override = date;
  },
};
