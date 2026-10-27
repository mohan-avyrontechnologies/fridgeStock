import type { Urgency } from '@fridgestock/shared';
import { CircleCheck, Clock, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { estimateNote, urgencyCopy } from '../copy';

/**
 * Colours per urgency: green, amber, orange, red. Each is a light tint with dark text of the same hue (and
 * a strong colour for bars). Always shown with an icon and urgencyCopy's text label, never colour alone.
 */
export const URGENCY_STYLE: Record<Urgency, { badge: string; bar: string; tile: string; icon: string }> = {
  NOT_URGENT: { badge: 'bg-ok text-ok-ink', bar: 'bg-ok-bar', tile: 'bg-ok text-ok-ink', icon: 'text-ok-bar' },
  APPROACHING_EXPIRY: {
    badge: 'bg-soon text-soon-ink',
    bar: 'bg-soon-bar',
    tile: 'bg-soon text-soon-ink',
    icon: 'text-soon-bar',
  },
  DUE: {
    badge: 'bg-today text-today-ink',
    bar: 'bg-today-bar',
    tile: 'bg-today text-today-ink',
    icon: 'text-today-bar',
  },
  OVERDUE: { badge: 'bg-past text-past-ink', bar: 'bg-past-bar', tile: 'bg-past text-past-ink', icon: 'text-past-bar' },
};

/** A different shape for each state, so the badge never relies on colour. */
export const URGENCY_ICON: Record<Urgency, LucideIcon> = {
  NOT_URGENT: CircleCheck,
  APPROACHING_EXPIRY: Clock,
  DUE: TriangleAlert,
  OVERDUE: OctagonAlert,
};

/** The urgency as a badge: a tinted pill with an icon and the text label. */
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const Icon = URGENCY_ICON[urgency];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-left text-xs font-semibold ${URGENCY_STYLE[urgency].badge}`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
      {urgencyCopy[urgency].label}
    </span>
  );
}

/** The required estimate line (copy.estimateNote). */
export function EstimateNote() {
  return (
    <p className="flex gap-2 text-sm leading-snug text-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{estimateNote}</span>
    </p>
  );
}
