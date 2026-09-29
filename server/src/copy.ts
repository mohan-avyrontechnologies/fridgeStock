/**
 * Every user-facing sentence the server produces about expiry lives here.
 * Food-safety boundary (BRD §10.3): dates are estimates for planning cooking.
 * Never describe food as fit, fine or guaranteed to eat; say "expected expiry".
 */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

export const reminderCopy = {
  APPROACHING_EXPIRY: (name: string, remainingDays: number, expiry: string) =>
    `${name}: expected expiry in ${days(remainingDays)} (${expiry}). Consider cooking it soon.`,
  DUE: (name: string) => `${name}: expected expiry is today. A good one to cook first.`,
  OVERDUE: (name: string, expiry: string) =>
    `${name} is past its expected expiry (${expiry}). Check its condition before deciding what to do with it.`,
};
