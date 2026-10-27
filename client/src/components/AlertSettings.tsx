import { DEFAULT_ALERTS, type AlertSettings as Alerts, type AlertSettingsInput } from '@fridgestock/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { alertCopy, mealSettingsCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { MealTimes, timeFieldClass } from './MealTimes';
import { Card, Switch } from './ui';

/**
 * Settings: reminder sounds, vibration and quiet hours, and the breakfast, lunch and dinner cooking reminders.
 * Every change is saved at once, and put back with a message if the server refuses it.
 */
export function AlertSettings() {
  const { user, setUser } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const [alerts, setAlerts] = useState<Alerts>(user?.alerts ?? DEFAULT_ALERTS);

  useEffect(() => {
    let current = true;
    api.alerts().then(
      (saved) => current && setAlerts(saved),
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
                  className={timeFieldClass}
                  value={quiet.start}
                  onChange={(e) => e.target.value && saveAlerts({ quietHours: { start: e.target.value } })}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">{alertCopy.to}</span>
                <input
                  type="time"
                  className={timeFieldClass}
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
        <MealTimes />
        <p className="mt-2 text-sm text-muted">{mealSettingsCopy.note}</p>
      </section>
    </>
  );
}
