import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { CURRENCIES, type Currency, type NotificationPreferences } from '@cook-first/shared';
import { PageBody, PageHeader } from '../components/AppShell';
import { AlertSettings } from '../components/AlertSettings';
import { PushReminders } from '../components/PushReminders';
import { YourData } from '../components/YourData';
import { EstimateNote } from '../components/Urgency';
import { Button, Chip, Card } from '../components/ui';
import { appearanceCopy, insightsCopy, productPhotoCopy, reminderPreferenceCopy, screenCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore, type Theme } from '../stores/themeStore';
import { useToastStore } from '../stores/toastStore';

const PREFS = (['approachingExpiry', 'due', 'overdue'] as const satisfies (keyof NotificationPreferences)[]).map(
  (key) => ({ key, ...reminderPreferenceCopy[key] }),
);

const THEMES: Theme[] = ['system', 'light', 'dark'];

export function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
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

  async function changeSavePhotos(savePhotos: boolean) {
    try {
      const { user: updated } = await api.updateMe({ savePhotos });
      setUser(updated);
    } catch {
      toast(productPhotoCopy.settingError);
    }
  }

  async function changeCurrency(currency: Currency) {
    try {
      const { user: updated } = await api.updateMe({ currency });
      setUser(updated);
    } catch {
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
        <Card as="section" className="p-4">
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
        </Card>

        <section>
          <h2 className="mb-1 text-lg font-semibold">Reminders</h2>
          <p className="mb-3 text-sm text-muted">Shown in the app under the bell. Turn off any you don’t want.</p>
          {prefsError && (
            <p role="alert" className="mb-3 rounded-button bg-past px-3.5 py-3 text-sm text-past-ink">
              {screenCopy.settings.preferencesError}
            </p>
          )}
          <Card as="ul" className="divide-y divide-line overflow-hidden">
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
          </Card>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">{insightsCopy.currencyTitle}</h2>
          <p className="mb-3 text-sm text-muted">{insightsCopy.currencyHint}</p>
          <select
            aria-label={insightsCopy.currencyTitle}
            value={user?.currency ?? 'USD'}
            onChange={(e) => changeCurrency(e.target.value as Currency)}
            className="block min-h-12 w-40 rounded-button border border-line bg-card px-3.5 text-base text-ink focus:border-brand focus:outline-none"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold">{appearanceCopy.title}</h2>
          <p className="mb-3 text-sm text-muted">{appearanceCopy.hint}</p>
          <div role="group" aria-label={appearanceCopy.title} className="flex gap-2">
            {THEMES.map((t) => (
              <Chip key={t} selected={theme === t} onClick={() => setTheme(t)}>
                {appearanceCopy.options[t]}
              </Chip>
            ))}
          </div>
        </section>

        <section aria-labelledby="photos-title">
          <h2 id="photos-title" className="mb-1 text-lg font-semibold">
            {productPhotoCopy.settingTitle}
          </h2>
          <label className="flex min-h-16 cursor-pointer items-center gap-4 rounded-card border border-line bg-card px-4 py-3">
            <span className="flex-1">
              <span className="block font-medium">{productPhotoCopy.settingLabel}</span>
              <span className="block text-sm text-muted">{productPhotoCopy.settingHint}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={user?.savePhotos ?? true}
              onChange={(e) => changeSavePhotos(e.target.checked)}
            />
            <span
              aria-hidden
              className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-brand after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
            />
          </label>
        </section>

        <PushReminders />

        <AlertSettings />

        <section>
          <h2 className="mb-2 text-lg font-semibold">{screenCopy.settings.aboutTitle}</h2>
          <EstimateNote />
        </section>

        <Link
          to="/welcome"
          className="flex min-h-14 items-center justify-between rounded-card border border-line bg-card px-4 font-medium hover:bg-paper"
        >
          How Cook First works
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Link>

        <Link
          to="/household"
          className="flex min-h-14 items-center justify-between rounded-card border border-line bg-card px-4 font-medium hover:bg-paper"
        >
          Household
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Link>

        <Link
          to="/insights"
          className="flex min-h-14 items-center justify-between rounded-card border border-line bg-card px-4 font-medium hover:bg-paper"
        >
          Insights
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Link>

        <Link
          to="/history"
          className="flex min-h-14 items-center justify-between rounded-card border border-line bg-card px-4 font-medium hover:bg-paper"
        >
          History
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Link>

        <YourData />

        <Button variant="danger" className="w-full" onClick={logout}>
          Log out
        </Button>
      </PageBody>
    </>
  );
}
