import {
  DEFAULT_ALERTS,
  DEFAULT_MEAL_REMINDERS,
  MEAL_TYPES,
  type AlertSettings as Alerts,
  type AlertSettingsInput,
  type MealReminders,
  type MealRemindersInput,
  type MealType,
} from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { alertCopy, mealSettingsCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { Switch, Card } from './ui';

const timeClass = 'min-h-12 rounded-button border border-line bg-card px-3 text-base';

/**
 * Settings: reminder sounds, vibration and quiet hours, and the breakfast, lunch and dinner cooking reminders.
 * Every change is saved at once, and put back with a message if the server refuses it.
 */
export function AlertSettings() {
  const { user, setUser } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const [alerts, setAlerts] = useState<Alerts>(user?.alerts ?? DEFAULT_ALERTS);
  const [meals, setMeals] = useState<MealReminders>(user?.mealReminders ?? DEFAULT_MEAL_REMINDERS);

  useEffect(() => {
    let current = true;
    api.alerts().then(
      (saved) => current && setAlerts(saved),
      () => {},
    );
    api.mealReminders().then(
      (saved) => current && setMeals(saved),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  async function saveAlerts(update: AlertSettingsInput) {
    const previous = alerts;
    setAlerts({ ...alerts, ...update, quietHours: { ...alerts.quietHours, ...update.quietHours } });
    try {
      const saved = await api.updateAlerts(update);
      setAlerts(saved);
      if (user) setUser({ ...user, alerts: saved });
    } catch {
      setAlerts(previous);
      toast(alertCopy.saveFailed);
    }
  }

  async function saveMeals(update: MealRemindersInput) {
    const previous = meals;
    setMeals(
      Object.fromEntries(MEAL_TYPES.map((meal) => [meal, { ...meals[meal], ...update[meal] }])) as MealReminders,
    );
    try {
      const saved = await api.updateMealReminders(update);
      setMeals(saved);
      if (user) setUser({ ...user, mealReminders: saved });
    } catch {
      setMeals(previous);
      toast(alertCopy.saveFailed);
    }
  }

  const quiet = alerts.quietHours;

  return (
    <>
      <section aria-labelledby="sounds-title">
        <h2 id="sounds-title" className="mb-1 text-lg font-semibold">
          {alertCopy.title}
        </h2>
        <p className="mb-3 text-sm text-muted">{alertCopy.intro}</p>
        <Card className="space-y-4 p-4">
          <Switch
            label={alertCopy.sound}
            hint={alertCopy.soundHint}
            checked={alerts.sound}
            onChange={(sound) => saveAlerts({ sound })}
          />
          <Switch
            label={alertCopy.vibration}
            hint={alertCopy.vibrationHint}
            checked={alerts.vibration}
            onChange={(vibration) => saveAlerts({ vibration })}
          />
          <Switch
            label={alertCopy.quiet}
            hint={alertCopy.quietHint}
            checked={quiet.enabled}
            onChange={(enabled) => saveAlerts({ quietHours: { enabled } })}
          />
          {quiet.enabled && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">{alertCopy.from}</span>
                <input
                  type="time"
                  className={timeClass}
                  value={quiet.start}
                  onChange={(e) => e.target.value && saveAlerts({ quietHours: { start: e.target.value } })}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">{alertCopy.to}</span>
                <input
                  type="time"
                  className={timeClass}
                  value={quiet.end}
                  onChange={(e) => e.target.value && saveAlerts({ quietHours: { end: e.target.value } })}
                />
              </label>
              <p className="basis-full text-sm text-muted">{alertCopy.zone(user?.timeZone ?? 'UTC')}</p>
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="meals-title">
        <h2 id="meals-title" className="mb-1 text-lg font-semibold">
          {mealSettingsCopy.title}
        </h2>
        <p className="mb-3 text-sm text-muted">{mealSettingsCopy.intro}</p>
        <Card as="ul" className="space-y-3 p-4">
          {MEAL_TYPES.map((meal: MealType) => (
            <li key={meal} className="space-y-2">
              <Switch
                label={mealSettingsCopy.meals[meal]}
                checked={meals[meal].enabled}
                onChange={(enabled) => saveMeals({ [meal]: { enabled } })}
              />
              {meals[meal].enabled && (
                <label className="flex items-center gap-3">
                  <span className="text-sm text-muted">{mealSettingsCopy.time(mealSettingsCopy.meals[meal])}</span>
                  <input
                    type="time"
                    aria-label={mealSettingsCopy.time(mealSettingsCopy.meals[meal])}
                    className={timeClass}
                    value={meals[meal].time}
                    onChange={(e) => e.target.value && saveMeals({ [meal]: { time: e.target.value } })}
                  />
                </label>
              )}
            </li>
          ))}
        </Card>
        <p className="mt-2 text-sm text-muted">{mealSettingsCopy.note}</p>
      </section>
    </>
  );
}
