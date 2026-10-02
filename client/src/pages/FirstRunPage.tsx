import { findReference, todayInTz, type Favourite } from '@cook-first/shared';
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { CameraScreen } from '../components/CameraScreen';
import { MealTimes } from '../components/MealTimes';
import { Button, Card, Chip, Toast } from '../components/ui';
import { estimateNote, firstRunCopy as copy } from '../copy';
import { usePushReminders } from '../lib/usePushReminders';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';
import type { ScannedItem } from '../lib/scanned';

const STEPS = 3;

/** Foods most people have, to add in a tap. Their units and usual lifespans come from the reference list. */
const QUICK_PICKS = ['Milk', 'Eggs', 'Bread', 'Chicken', 'Spinach', 'Yoghurt', 'Carrots'];

/**
 * A three-step guide, shown once to a new account (and any time from Settings):
 * 1. what "expected expiry" means, with the disclaimer;
 * 2. adding the first food, with the camera or in a tap from favourites and common foods;
 * 3. choosing meal times and turning on reminders. This step, and Settings, are the only places the phone's
 *    permission for notifications is ever asked, and only when "Turn on reminders" is tapped.
 */
export function FirstRunPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const toast = useToastStore((s) => s.show);
  const addBulk = useFoodStore((s) => s.addBulk);
  const addFavourite = useFoodStore((s) => s.addFavourite);
  const [step, setStep] = useState(1);
  const [camera, setCamera] = useState(false);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const push = usePushReminders();

  useEffect(() => {
    let current = true;
    api.favourites().then(
      ({ items }) => current && setFavourites(items),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  // Each step starts with focus on its heading, so a screen reader announces where you are.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  /** Marks the guide as seen (finished or skipped) and leaves. */
  async function leave(to = '/', state?: unknown) {
    try {
      const { user: saved } = await api.updateMe({ firstRunDone: true });
      setUser(saved);
    } catch {
      // Not being able to save that must not trap anyone in the guide.
      if (user) setUser({ ...user, firstRunDone: true });
      toast(copy.saveFailed);
    }
    navigate(to, { replace: true, state });
  }

  async function addPicked() {
    setBusy(true);
    try {
      const items = picked.flatMap((name) => {
        const reference = findReference(name);
        const days = reference?.lifespanDays.FRIDGE;
        return reference && days != null
          ? [{ name, quantity: 1, unit: reference.unit, lifespanDays: days, storage: 'FRIDGE' as const }]
          : [];
      });
      const zone = user?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      await addBulk({ addedDate: todayInTz(zone), storage: 'FRIDGE', items });
      setAdded((previous) => [...previous, ...picked]);
      setPicked([]);
      toast(copy.addedToast(items.length));
    } catch {
      toast(copy.addFailed);
    } finally {
      setBusy(false);
    }
  }

  async function readd(favourite: Favourite) {
    try {
      await addFavourite(favourite.id);
      setAdded((previous) => [...previous, favourite.name]);
      toast(copy.addedToast(1));
    } catch {
      toast(copy.addFailed);
    }
  }

  function scanned(items: ScannedItem[]) {
    setCamera(false);
    if (items.length > 0) void leave('/add/bulk', { scanned: items });
  }

  const titles = [copy.step1.title, copy.step2.title, copy.step3.title];

  return (
    <main className="top-inset bottom-inset mx-auto min-h-dvh max-w-xl space-y-6 px-4 py-6 lg:py-12">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted" aria-live="polite">
            {copy.progress(step, STEPS)}
          </p>
          <button
            type="button"
            onClick={() => void leave()}
            className="inline-flex min-h-12 items-center px-2 text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            {copy.skip}
          </button>
        </div>
        <div aria-hidden className="flex gap-2">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand' : 'bg-line'}`} />
          ))}
        </div>
        <h1 ref={heading} tabIndex={-1} className="pt-2 text-3xl font-bold tracking-tight focus:outline-none">
          {step === 1 ? copy.welcome : titles[step - 1]}
        </h1>
        {step === 1 && <h2 className="text-xl font-semibold">{titles[0]}</h2>}
      </header>

      {step === 1 && (
        <section aria-label={titles[0]} className="space-y-4">
          <p className="text-base">{copy.step1.body}</p>
          <ul className="list-disc space-y-1.5 pl-5 text-base">
            {copy.step1.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <Card className="space-y-1 border-brand p-4" role="note" aria-label={copy.step1.disclaimerLabel}>
            <p className="font-display text-lg font-semibold">{copy.step1.disclaimerLabel}</p>
            <p className="text-base">{estimateNote}</p>
          </Card>
        </section>
      )}

      {step === 2 && (
        <section aria-label={titles[1]} className="space-y-5">
          <p className="text-base">{copy.step2.body}</p>
          <Button className="w-full" onClick={() => setCamera(true)}>
            <Camera aria-hidden className="size-5" /> {copy.step2.camera}
          </Button>
          {camera && <CameraScreen onDone={scanned} onClose={() => setCamera(false)} />}

          {favourites.length > 0 && (
            <div>
              <h3 className="mb-2 text-base font-semibold">{copy.step2.favourites}</h3>
              <div className="flex flex-wrap gap-2">
                {favourites.map((favourite) => (
                  <Chip
                    key={favourite.id}
                    aria-label={`Add ${favourite.name} again`}
                    onClick={() => void readd(favourite)}
                  >
                    {favourite.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div role="group" aria-labelledby="quick-picks">
            <h3 id="quick-picks" className="mb-2 text-base font-semibold">
              {copy.step2.common}
            </h3>
            <p className="mb-2 text-sm text-muted">{copy.step2.commonHint}</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PICKS.filter((name) => !added.includes(name)).map((name) => (
                <Chip
                  key={name}
                  selected={picked.includes(name)}
                  onClick={() =>
                    setPicked((previous) =>
                      previous.includes(name) ? previous.filter((n) => n !== name) : [...previous, name],
                    )
                  }
                >
                  {name}
                </Chip>
              ))}
            </div>
            {picked.length > 0 && (
              <Button className="mt-3 w-full" variant="secondary" disabled={busy} onClick={() => void addPicked()}>
                {copy.step2.addPicked(picked.length)}
              </Button>
            )}
          </div>
          {added.length > 0 && (
            <p role="status" className="rounded-button bg-ok px-3.5 py-3 text-base text-ok-ink">
              {copy.step2.added(added)}
            </p>
          )}
        </section>
      )}

      {step === 3 && (
        <section aria-label={titles[2]} className="space-y-5">
          <p className="text-base">{copy.step3.body}</p>
          <MealTimes />
          <Card className="space-y-3 p-4">
            <h3 className="font-display text-lg font-semibold">{copy.step3.reminders}</h3>
            <p className="text-sm text-muted">{copy.step3.permission}</p>
            {push.message && <p className="rounded-button bg-paper px-3.5 py-3 text-sm">{push.message}</p>}
            {(push.state === 'off' || push.state === 'blocked') && (
              <Button className="w-full" disabled={push.busy} onClick={() => void push.enable()}>
                {copy.step3.turnOn}
              </Button>
            )}
            {push.state === 'on' && <p className="font-medium">{copy.step3.on}</p>}
            {push.note && (
              <p role="alert" className="text-sm text-muted">
                {push.note}
              </p>
            )}
          </Card>
        </section>
      )}

      <nav aria-label={copy.navigation} className="flex gap-3 pt-2">
        {step > 1 && (
          <Button variant="secondary" className="flex-1" onClick={() => setStep(step - 1)}>
            <ChevronLeft aria-hidden className="size-5" /> {copy.back}
          </Button>
        )}
        {step < STEPS ? (
          <Button className="flex-1" onClick={() => setStep(step + 1)}>
            {copy.next} <ChevronRight aria-hidden className="size-5" />
          </Button>
        ) : (
          <Button className="flex-1" onClick={() => void leave()}>
            {copy.finish}
          </Button>
        )}
      </nav>
      <Toast />
    </main>
  );
}
