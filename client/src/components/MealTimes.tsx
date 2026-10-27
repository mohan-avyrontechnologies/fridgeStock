import {
  DEFAULT_MEAL_REMINDERS,
  MEAL_TYPES,
  type MealReminders,
  type MealRemindersInput,
  type MealType,
} from '@fridgestock/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { alertCopy, mealSettingsCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { Card, Switch } from './ui';

export const timeFieldClass = 'min-h-12 rounded-button border border-field bg-card px-3 text-base';

/**
 * Breakfast, lunch and dinner: a switch and a time for each cooking reminder. Used in Settings and in the
 * first-run guide. Every change is saved at once, and put back with a message if the server refuses it.
 */
export function MealTimes() {
  const { user, setUser } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const [meals, setMeals] = useState<MealReminders>(user?.mealReminders ?? DEFAULT_MEAL_REMINDERS);

  useEffect(() => {
    let current = true;
    api.mealReminders().then(
      (saved) => current && setMeals(saved),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  async function save(update: MealRemindersInput) {
    const previous = meals;
    setMeals(
      Object.fromEntries(MEAL_TYPES.map((meal) => [meal, { ...meals[meal], ...update[meal] }])) as MealReminders,
    );
    try {
      const saved = await api.updateMealReminders(update);
      setMeals(saved);
      const current = useAuthStore.getState().user;
      if (current) setUser({ ...current, mealReminders: saved });
    } catch {
      setMeals(previous);
      toast(alertCopy.saveFailed);
    }
  }

  return (
    <Card as="ul" className="space-y-3 p-4">
      {MEAL_TYPES.map((meal: MealType) => (
        <li key={meal} className="space-y-2">
          <Switch
            label={mealSettingsCopy.meals[meal]}
            checked={meals[meal].enabled}
            onChange={(enabled) => save({ [meal]: { enabled } })}
          />
          {meals[meal].enabled && (
            <label className="flex items-center gap-3">
              <span className="text-sm text-muted">{mealSettingsCopy.time(mealSettingsCopy.meals[meal])}</span>
              <input
                type="time"
                aria-label={mealSettingsCopy.time(mealSettingsCopy.meals[meal])}
                className={timeFieldClass}
                value={meals[meal].time}
                onChange={(e) => e.target.value && save({ [meal]: { time: e.target.value } })}
              />
            </label>
          )}
        </li>
      ))}
    </Card>
  );
}
