import {
  addDays,
  formatDisplay,
  mealPlanEntrySchema,
  type MealPlan,
  type MealPlanDraft,
  type MealPlanEntry,
  type MealType,
  MEAL_TYPES,
} from '@cook-first/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { Button, Chip, EmptyState, Field, Spinner } from '../components/ui';
import { aiCopy, mealSettingsCopy, planCopy as copy } from '../copy';
import { check } from '../lib/validation';
import { useAiStore } from '../stores/aiStore';
import { useFoodStore } from '../stores/foodStore';
import { useToastStore } from '../stores/toastStore';

/** A simple plan for today and the next six days. */
export function PlanPage() {
  const toast = useToastStore((s) => s.show);
  const refreshFood = useFoodStore((s) => s.refresh);
  const ai = useAiStore((s) => s.status);
  const loadAi = useAiStore((s) => s.load);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MealPlanDraft | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which meal the plan shows. Dinner is the main one, and the one the AI suggestions are for.
  const [meal, setMeal] = useState<MealType>('dinner');

  const load = useCallback(async () => {
    try {
      setPlan(await api.mealPlan());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    let current = true;
    api.mealPlan().then(
      (loaded) => current && setPlan(loaded),
      () => current && setLoadError(true),
    );
    void refreshFood();
    void loadAi();
    return () => {
      current = false;
    };
  }, [refreshFood, loadAi]);

  const dayLabel = (date: string) =>
    plan && date === plan.today
      ? copy.today
      : plan && date === addDays(plan.today, 1)
        ? copy.tomorrow
        : formatDisplay(date);

  async function clear(date: string) {
    try {
      await api.clearMeal(date, meal);
      await load();
    } catch {
      toast('Couldn’t save that. Try again.');
    }
  }

  async function suggest() {
    setBusy(true);
    setAiError(null);
    try {
      setDraft(await api.suggestMealPlan());
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
      void loadAi();
    }
  }

  /** The draft is only saved when the user chooses to add it. */
  async function addDraft() {
    if (!draft) return;
    setBusy(true);
    try {
      for (const day of draft.days) {
        await api.setMeal(day.date, { meal: 'dinner', title: day.title, foodIds: day.foods.map((f) => f.id) });
      }
      setDraft(null);
      toast(copy.added);
      await load();
    } catch {
      toast('Couldn’t save that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const entryOf = (day: MealPlan['days'][number]) => day.meals?.[meal] ?? (meal === 'dinner' ? day.entry : null);
  const hasEmptyDay = plan?.days.some((day) => !day.entry) ?? false;

  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <PageBody narrow>
        {!plan && !loadError && <Spinner />}
        {loadError && !plan && <EmptyState title={copy.loadError} />}

        <div role="group" aria-label={copy.mealChoice} className="flex gap-2">
          {MEAL_TYPES.map((type) => (
            <Chip key={type} selected={meal === type} onClick={() => setMeal(type)}>
              {mealSettingsCopy.meals[type]}
            </Chip>
          ))}
        </div>

        {plan && ai?.enabled && meal === 'dinner' && (
          <section className="space-y-2">
            {hasEmptyDay ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={suggest} disabled={busy}>
                  {busy && !draft ? aiCopy.busy : copy.suggest}
                </Button>
                <span className="text-sm text-muted">{aiCopy.left(ai.usedToday, ai.dailyLimit)}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">{copy.full}</p>
            )}
            {aiError && (
              <p role="alert" className="rounded-xl bg-past px-3.5 py-3 text-sm text-past-ink">
                {aiError}
              </p>
            )}
          </section>
        )}

        {meal === 'dinner' && draft && draft.days.length > 0 && (
          <section aria-labelledby="draft-title" className="rounded-2xl border border-brand/40 bg-brand-soft p-4">
            <h2 id="draft-title" className="font-semibold">
              {copy.draftTitle}
            </h2>
            <p className="mb-2 text-sm text-muted">{copy.draftHint}</p>
            <ul className="space-y-2">
              {draft.days.map((day) => (
                <li key={day.date}>
                  <span className="font-medium">{dayLabel(day.date)}:</span> {day.title}
                  {day.foods.length > 0 && (
                    <span className="text-sm text-muted"> · {day.foods.map((f) => f.name).join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">{aiCopy.note}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>
                {copy.discard}
              </Button>
              <Button className="flex-1" onClick={addDraft} disabled={busy}>
                {copy.addDraft}
              </Button>
            </div>
          </section>
        )}

        {plan && (
          <ul className="space-y-3">
            {plan.days.map((day) => (
              <li key={day.date} className="rounded-2xl border border-line bg-card p-4">
                <h2 className="text-sm font-semibold text-muted">{dayLabel(day.date)}</h2>
                {editing === day.date ? (
                  <MealForm
                    date={day.date}
                    meal={meal}
                    entry={entryOf(day)}
                    onDone={async () => {
                      setEditing(null);
                      await load();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : entryOf(day) ? (
                  <>
                    <p className="mt-1 text-base font-semibold">{entryOf(day)!.title}</p>
                    {entryOf(day)!.foods.length > 0 && (
                      <p className="text-sm text-muted">
                        {entryOf(day)!
                          .foods.map((f) => (f.status === 'ACTIVE' ? f.name : `${f.name} (${copy.gone})`))
                          .join(', ')}
                      </p>
                    )}
                    <div className="-ml-4 mt-1 flex">
                      <Button variant="ghost" onClick={() => setEditing(day.date)}>
                        {copy.edit}
                      </Button>
                      <Button variant="ghost" onClick={() => clear(day.date)}>
                        {copy.clear}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-muted">{copy.nothing}</p>
                    <Button variant="ghost" className="-ml-4" onClick={() => setEditing(day.date)}>
                      {copy.add}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}

function MealForm({
  date,
  meal,
  entry,
  onDone,
  onCancel,
}: {
  date: string;
  meal: MealType;
  entry: MealPlanEntry | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  // The user's active food in Cook First order (most urgent first).
  const inventory = useFoodStore((s) => s.inventory);
  const food = inventory?.items ?? [];
  const [title, setTitle] = useState(entry?.title ?? '');
  const [chosen, setChosen] = useState<string[]>(
    entry?.foods.filter((f) => f.status === 'ACTIVE').map((f) => f.id) ?? [],
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setChosen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  async function save(e: FormEvent) {
    e.preventDefault();
    // The title is checked here; the server also checks the food belongs to this user.
    const { data, errors } = check(mealPlanEntrySchema.pick({ title: true }), { title });
    if (!data) return setError(errors.title);
    setBusy(true);
    try {
      await api.setMeal(date, { meal, title: data.title, foodIds: chosen });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="mt-2 space-y-3">
      <Field
        label={copy.mealLabel}
        placeholder={copy.mealPlaceholder}
        maxLength={80}
        autoFocus
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setError(undefined);
        }}
        error={error}
      />
      {food.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium text-ink">{copy.foodsLabel}</legend>
          <p className="mb-1.5 text-sm text-muted">{copy.foodsHint}</p>
          <div className="flex flex-wrap gap-2">
            {food.slice(0, 12).map((item) => (
              <Chip key={item.id} selected={chosen.includes(item.id)} onClick={() => toggle(item.id)}>
                {item.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          {copy.cancel}
        </Button>
        <Button type="submit" className="flex-1" disabled={busy}>
          {copy.save}
        </Button>
      </div>
    </form>
  );
}
