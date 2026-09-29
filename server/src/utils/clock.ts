/** Single source of "now" so tests can pin the date without faking timers. */
let override: Date | null = null;

export const clock = {
  now(): Date {
    return override ? new Date(override) : new Date();
  },
  set(date: Date | null): void {
    override = date;
  },
};
