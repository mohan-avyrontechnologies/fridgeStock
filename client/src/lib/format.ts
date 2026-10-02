/** Display helpers for values that aren't calendar dates (those use formatDisplay from @cook-first/shared). */

/** "12 pcs", "0.75 l". */
export function formatQuantity(quantity: number, unit: string): string {
  const n = Number.isInteger(quantity) ? quantity : Number(quantity.toFixed(3));
  return `${n} ${unit}`;
}

/** An event timestamp such as "29 Sep, 10:30" in the viewer's locale. */
export function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "$4.50" in the user's chosen currency (display only; nothing is converted). */
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}
