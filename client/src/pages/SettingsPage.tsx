import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { NotificationPreferences } from '@cook-first/shared';
import { PageBody, PageHeader } from '../components/AppShell';
import { EstimateNote } from '../components/Urgency';
import { Button } from '../components/ui';
import { reminderPreferenceCopy, screenCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

const PREFS = (['approachingExpiry', 'due', 'overdue'] as const satisfies (keyof NotificationPreferences)[]).map(
  (key) => ({ key, ...reminderPreferenceCopy[key] }),
);

export function SettingsPage() {
  const { user, setUser, logout } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(user?.notificationPreferences ?? null);
  const [prefsError, setPrefsError] = useState(false);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    api.preferences().then(setPrefs, () => setPrefsError(true));
  }, []);

  async function toggle(key: keyof NotificationPreferences) {
    if (!prefs || !user) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const saved = await api.updatePreferences({ [key]: next[key] });
      setPrefs(saved);
      setUser({ ...user, notificationPreferences: saved });
    } catch {
      setPrefs(prefs);
      toast('Couldn’t save that. Try again.');
    }
  }

  async function useDeviceZone() {
    const { user: updated } = await api.updateMe({ timeZone: deviceZone });
    setUser(updated);
    toast('Time zone updated');
  }

  return (
    <>
      <PageHeader title="Settings" />
      <PageBody narrow>
        <section className="rounded-2xl border border-line bg-card p-4">
          <dl className="space-y-2">
            <div>
              <dt className="text-sm text-muted">Name</dt>
              <dd className="font-semibold">{user?.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Email</dt>
              <dd className="font-semibold">{user?.email}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            “Today” is based on <span className="font-medium text-ink">{user?.timeZone}</span>.
          </p>
          {user && user.timeZone !== deviceZone && (
            <Button variant="ghost" className="-ml-4 mt-1" onClick={useDeviceZone}>
              Use this device’s time zone ({deviceZone})
            </Button>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">Reminders</h2>
          <p className="mb-3 text-sm text-muted">Shown in the app under the bell. Turn off any you don’t want.</p>
          {prefsError && (
            <p role="alert" className="mb-3 rounded-xl bg-past px-3.5 py-3 text-sm text-past-ink">
              {screenCopy.settings.preferencesError}
            </p>
          )}
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {PREFS.map(({ key, title, detail }) => (
              <li key={key}>
                <label className="flex min-h-16 cursor-pointer items-center gap-4 px-4 py-3">
                  <span className="flex-1">
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-muted">{detail}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={prefs?.[key] ?? false}
                    disabled={!prefs}
                    onChange={() => toggle(key)}
                  />
                  <span
                    aria-hidden
                    className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-brand after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">{screenCopy.settings.aboutTitle}</h2>
          <EstimateNote />
        </section>

        <Link
          to="/history"
          className="flex min-h-14 items-center justify-between rounded-2xl border border-line bg-card px-4 font-medium hover:bg-paper"
        >
          History
          <span aria-hidden className="text-muted">›</span>
        </Link>

        <Button variant="danger" className="w-full" onClick={logout}>
          Log out
        </Button>
      </PageBody>
    </>
  );
}
