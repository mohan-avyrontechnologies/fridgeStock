import { REMINDER_MODES, type ReminderDelivery, type ReminderMode } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { pushSettingsCopy as copy } from '../copy';
import { usePushReminders } from '../lib/usePushReminders';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Chip, Card } from './ui';

const DEFAULT_DELIVERY: ReminderDelivery = { mode: 'DIGEST', hour: 8 };
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * Settings: push reminders for this device, and how and when they arrive.
 * Permission is only asked for when "Turn on reminders" is tapped.
 */
export function PushReminders() {
  const { user, setUser } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const [delivery, setDelivery] = useState<ReminderDelivery>(user?.reminderDelivery ?? DEFAULT_DELIVERY);
  const { state, note, busy, enable, disable, message } = usePushReminders();

  useEffect(() => {
    let current = true;
    api.delivery().then(
      (saved) => current && setDelivery(saved),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  async function save(update: Partial<ReminderDelivery>) {
    const previous = delivery;
    setDelivery({ ...delivery, ...update });
    try {
      const saved = await api.updateDelivery(update);
      setDelivery(saved);
      if (user) setUser({ ...user, reminderDelivery: saved });
    } catch {
      setDelivery(previous);
      toast(copy.saveFailed);
    }
  }

  return (
    <section aria-labelledby="push-title">
      <h2 id="push-title" className="mb-1 text-lg font-semibold">
        {copy.title}
      </h2>
      <p className="mb-3 text-sm text-muted">{copy.intro}</p>

      <Card className="space-y-3 p-4">
        {message && (
          <p role="status" className="rounded-button bg-paper px-3.5 py-3 text-sm text-ink">
            {message}
          </p>
        )}
        {state === 'off' && (
          <Button className="w-full" onClick={enable} disabled={busy}>
            {copy.turnOn}
          </Button>
        )}
        {state === 'blocked' && (
          <Button variant="secondary" className="w-full" onClick={enable} disabled={busy}>
            {copy.turnOn}
          </Button>
        )}
        {state === 'on' && (
          <>
            <p className="font-medium">{copy.on}</p>
            <Button variant="secondary" className="w-full" onClick={disable} disabled={busy}>
              {copy.turnOff}
            </Button>
          </>
        )}
        {note && (
          <p role="alert" className="text-sm text-muted">
            {note}
          </p>
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink">{copy.modeTitle}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {REMINDER_MODES.map((mode: ReminderMode) => (
              <Chip key={mode} selected={delivery.mode === mode} onClick={() => save({ mode })}>
                <span className="block py-1 text-left">
                  <span className="block">{copy.modes[mode].title}</span>
                  <span className={`block text-xs ${delivery.mode === mode ? 'text-on-brand' : 'text-muted'}`}>
                    {copy.modes[mode].detail}
                  </span>
                </span>
              </Chip>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">{copy.timeLabel}</span>
          <select
            className="min-h-12 w-full rounded-button border border-line bg-card px-3 text-base"
            value={delivery.hour}
            onChange={(e) => save({ hour: Number(e.target.value) })}
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {copy.hour(hour)}
              </option>
            ))}
          </select>
        </label>

        <p className="text-sm text-muted">{copy.inAppNote}</p>
      </Card>
    </section>
  );
}
