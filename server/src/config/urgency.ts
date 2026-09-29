/**
 * The one place the urgency threshold is defined. An item with this many days
 * or fewer left (but more than 0) is APPROACHING_EXPIRY ("Use soon"); more than
 * this is NOT_URGENT. Nothing else may hard-code the number (structure.test.ts).
 */
export const APPROACHING_EXPIRY_DAYS = 3;
