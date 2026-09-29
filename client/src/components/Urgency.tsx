import type { Urgency } from '../api/types';
import { estimateNote, urgencyCopy } from '../copy';

export const URGENCY_STYLE: Record<Urgency, { badge: string; bar: string; tile: string }> = {
  NOT_URGENT: { badge: 'bg-calm text-calm-ink', bar: 'bg-calm-bar', tile: 'bg-calm text-calm-ink' },
  USE_SOON: { badge: 'bg-soon text-soon-ink', bar: 'bg-soon-bar', tile: 'bg-soon text-soon-ink' },
  DUE_TODAY: { badge: 'bg-today text-today-ink', bar: 'bg-today-bar', tile: 'bg-today text-today-ink' },
  PAST_EXPECTED_EXPIRY: { badge: 'bg-past text-past-ink', bar: 'bg-past-bar', tile: 'bg-past text-past-ink' },
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${URGENCY_STYLE[urgency].badge}`}
    >
      {urgencyCopy[urgency].label}
    </span>
  );
}

/** The required estimate line (copy.estimateNote). */
export function EstimateNote() {
  return (
    <p className="flex gap-2 text-[13px] leading-snug text-muted">
      <svg aria-hidden viewBox="0 0 20 20" className="mt-px size-4 shrink-0 fill-current">
        <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM11 14.5H9v-5h2v5Z" />
      </svg>
      <span>{estimateNote}</span>
    </p>
  );
}
