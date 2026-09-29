/** Calendar-date helpers. Dates travel as "YYYY-MM-DD" keys, never instants. */

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function addDaysToKey(key: string, days: number): string {
  return new Date(keyToUtc(key).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((keyToUtc(toKey).getTime() - keyToUtc(fromKey).getTime()) / 86_400_000);
}

/** "Wed 1 Oct", with the year added when it isn't the current one. */
export function formatDateKey(key: string): string {
  const date = keyToUtc(key);
  const sameYear = date.getUTCFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(date);
}

export function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatQuantity(quantity: number, unit: string): string {
  const n = Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(3));
  return `${n} ${unit}`;
}
