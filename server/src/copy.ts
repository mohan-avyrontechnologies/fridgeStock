/**
 * Every user-facing sentence the server produces about expiry lives here, and
 * nowhere else (tests/foodSafetyCopy.test.ts checks).
 * Food-safety boundary (BRD §10.3): dates are planning estimates. Never claim
 * food is fit to eat; use "expected expiry" wording only.
 */

/** "1 day", "2 days". */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** Reminder messages. {n} is worked out at the moment the reminder is sent. */
export const reminderCopy = {
  APPROACHING_EXPIRY: (name: string, remainingDays: number) =>
    `${name}: expected expiry in ${days(remainingDays)}. Consider using it soon.`,
  DUE: (name: string) => `${name}: expected expiry is today.`,
  OVERDUE: (name: string) => `${name} is past its expected expiry. Check it before using.`,
};
