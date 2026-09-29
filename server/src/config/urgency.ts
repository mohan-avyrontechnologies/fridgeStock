import type { Urgency } from '@cook-first/shared';

/**
 * Urgency is derived from remaining days until the expected expiry date.
 * Thresholds are configuration, not a fixed contract (FRD §7.5).
 */

/** Higher rank = needs attention sooner. */
export const URGENCY_RANK: Record<Urgency, number> = {
  NOT_URGENT: 0,
  USE_SOON: 1,
  DUE_TODAY: 2,
  PAST_EXPECTED_EXPIRY: 3,
};

export interface UrgencyThresholds {
  /** An item with this many remaining days or fewer (and more than 0) is "Use soon". */
  useSoonDays: number;
  /** Items at or above this urgency appear in Cook First. */
  cookFirstMinimum: Urgency;
}

export const DEFAULT_THRESHOLDS: UrgencyThresholds = {
  useSoonDays: 3,
  cookFirstMinimum: 'USE_SOON',
};
