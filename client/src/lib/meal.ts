import { hourInTz, type MealType } from '@cook-first/shared';

/**
 * Which meal it is now: breakfast until 11:00, lunch until 16:00, dinner after that (and through the night,
 * so a late snack still reads as "dinner" and the early hours as "breakfast").
 */
export function currentMeal(timeZone: string, now: Date): MealType {
  const hour = hourInTz(timeZone, now);
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}
