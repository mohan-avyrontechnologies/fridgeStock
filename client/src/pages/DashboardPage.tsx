import { formatDisplay, STORAGE_LOCATIONS, type MealPlan, type StorageLocation } from '@cook-first/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { CookFirstToday } from '../components/CookFirstToday';
import { FoodList } from '../components/FoodCard';
import { Button, Chip, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { EstimateNote } from '../components/Urgency';
import { homeCopy, screenCopy, storageLabel } from '../copy';
import { currentMeal } from '../lib/meal';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';

type Filter = 'ALL' | StorageLocation;

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { inventory, cookFirst, error, refresh } = useFoodStore();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [plan, setPlan] = useState<MealPlan | null>(null);

  // Today's planned meals, for the current meal's suggestion. Home works without them.
  useEffect(() => {
    let current = true;
    api.mealPlan().then(
      (loaded) => current && setPlan(loaded),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  const meal = currentMeal(user?.timeZone ?? 'UTC', new Date());
  const shown = inventory?.items.filter((item) => filter === 'ALL' || item.storage === filter) ?? [];
  const title = filter === 'ALL' ? `All food (${shown.length})` : `${storageLabel[filter]} (${shown.length})`;

  return (
    <>
      <PageHeader
        title={user ? `Hi, ${user.name}` : 'Your fridge'}
        subtitle={inventory ? formatDisplay(inventory.today) : undefined}
        showIcons
      />
      <PageBody>
        {!inventory && !error && <Spinner />}
        {error && !inventory && (
          <EmptyState title={screenCopy.dashboard.loadError}>
            <p>{error}</p>
            <Button variant="secondary" className="mt-4" onClick={() => refresh()}>
              Try again
            </Button>
          </EmptyState>
        )}

        {inventory && (
          <>
            <CookFirstToday items={cookFirst ?? []} meal={meal} plan={plan} />

            <section aria-labelledby="all-food-heading" className="space-y-3">
              <div
                role="group"
                aria-label={homeCopy.locationGroup}
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
              >
                {(['ALL', ...STORAGE_LOCATIONS] as const).map((option) => (
                  <Chip key={option} selected={filter === option} onClick={() => setFilter(option)}>
                    {option === 'ALL' ? homeCopy.all : storageLabel[option]}
                  </Chip>
                ))}
              </div>
              <SectionTitle id="all-food-heading">{title}</SectionTitle>
              {inventory.items.length === 0 ? (
                <EmptyState
                  title={screenCopy.dashboard.emptyInventory}
                  action={<Button onClick={() => navigate('/add')}>{homeCopy.addFood}</Button>}
                />
              ) : shown.length === 0 ? (
                <EmptyState
                  title={homeCopy.noneIn(storageLabel[filter as StorageLocation].toLowerCase())}
                  action={<Button onClick={() => navigate('/add')}>{homeCopy.addFood}</Button>}
                />
              ) : (
                <>
                  <p className="-mt-2 text-sm text-muted">{screenCopy.dashboard.sortedHint}</p>
                  <FoodList items={shown} />
                </>
              )}
            </section>

            <Link
              to="/insights"
              className="flex min-h-14 items-center justify-between rounded-card border border-line bg-card px-4 font-medium hover:bg-paper"
            >
              {screenCopy.dashboard.insightsLink}
              <ChevronRight aria-hidden className="size-5 text-muted" />
            </Link>
            <EstimateNote />
          </>
        )}
      </PageBody>
    </>
  );
}
