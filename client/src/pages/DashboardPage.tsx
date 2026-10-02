import { formatDisplay, type Urgency } from '@cook-first/shared';
import { Link } from 'react-router';
import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { EstimateNote, URGENCY_STYLE } from '../components/Urgency';
import { Button, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { screenCopy, urgencyCopy, urgencyShortLabel } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';

/** How many urgent items the dashboard's Cook First section shows (unrelated to the urgency threshold). */
const COOK_FIRST_PREVIEW = 3;

/** Summary bar order: past expected expiry, due today, use soon, not urgent. */
const ORDER: Urgency[] = ['OVERDUE', 'DUE', 'APPROACHING_EXPIRY', 'NOT_URGENT'];

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { inventory, cookFirst, error, refresh } = useFoodStore();

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
            <section aria-label="Summary">
              <ul className="grid grid-cols-4 gap-2 lg:gap-4">
                {ORDER.map((u) => (
                  <li
                    key={u}
                    className={`rounded-2xl px-2 py-3 text-center lg:px-5 lg:py-5 lg:text-left ${URGENCY_STYLE[u].tile}`}
                  >
                    <p className="text-2xl font-bold tabular-nums lg:text-4xl">{inventory.summary[u]}</p>
                    <p className="text-[11px] leading-tight font-semibold lg:hidden">{urgencyShortLabel[u]}</p>
                    <p className="hidden text-sm font-semibold lg:block">{urgencyCopy[u].label}</p>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid gap-7 lg:grid-cols-2 lg:items-start lg:gap-8">
              <section aria-labelledby="cook-first-heading">
                <SectionTitle
                  id="cook-first-heading"
                  action={
                    <Link
                      to="/cook-first"
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
                    >
                      {screenCopy.dashboard.seeAll}
                    </Link>
                  }
                >
                  Cook First
                </SectionTitle>
                {cookFirst && cookFirst.length > 0 ? (
                  <FoodList items={cookFirst.slice(0, COOK_FIRST_PREVIEW)} />
                ) : (
                  <EmptyState title={screenCopy.dashboard.nothingUrgent} />
                )}
              </section>

              <section aria-labelledby="all-food-heading">
                <SectionTitle id="all-food-heading">All food ({inventory.items.length})</SectionTitle>
                {inventory.items.length === 0 ? (
                  <EmptyState title={screenCopy.dashboard.emptyInventory}>
                    <Link
                      to="/add"
                      className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-on-brand"
                    >
                      Add food
                    </Link>
                  </EmptyState>
                ) : (
                  <>
                    <p className="-mt-2 mb-3 text-sm text-muted">{screenCopy.dashboard.sortedHint}</p>
                    <FoodList items={inventory.items} />
                  </>
                )}
              </section>
            </div>
            <Link
              to="/insights"
              className="flex min-h-14 items-center justify-between rounded-2xl border border-line bg-card px-4 font-medium hover:bg-paper"
            >
              {screenCopy.dashboard.insightsLink}
              <span aria-hidden className="text-muted">
                ›
              </span>
            </Link>
            <EstimateNote />
          </>
        )}
      </PageBody>
    </>
  );
}
