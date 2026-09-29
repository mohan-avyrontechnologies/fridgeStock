import { Link } from 'react-router';
import type { Urgency } from '@cook-first/shared';
import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { EstimateNote, URGENCY_STYLE } from '../components/Urgency';
import { Button, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { screenCopy, urgencyCopy, urgencyShortLabel } from '../copy';
import { formatDisplay } from '@cook-first/shared';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';

const ORDER: Urgency[] = ['PAST_EXPECTED_EXPIRY', 'DUE_TODAY', 'USE_SOON', 'NOT_URGENT'];

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { inventory, cookFirst, error, refresh } = useFoodStore();
  const firstName = user?.name.split(' ')[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Hi, ${firstName}` : 'Your fridge'}
        subtitle={inventory ? formatDisplay(inventory.today) : undefined}
      />
      <PageBody>
        {!inventory && !error && <Spinner />}
        {error && !inventory && (
          <EmptyState title="Couldn’t load your food">
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
                  <li key={u} className={`rounded-2xl px-2 py-3 text-center lg:px-5 lg:py-5 lg:text-left ${URGENCY_STYLE[u].tile}`}>
                    <p className="text-2xl font-bold tabular-nums lg:text-4xl">{inventory.summary[u]}</p>
                    <p className="text-[11px] leading-tight font-semibold lg:hidden">{urgencyShortLabel[u]}</p>
                    <p className="hidden text-sm font-semibold lg:block">{urgencyCopy[u].label}</p>
                  </li>
                ))}
              </ul>
            </section>

            {inventory.items.length === 0 ? (
              <EmptyState title="Nothing logged yet">
                <p>{screenCopy.dashboard.emptyBody}</p>
                <Link to="/add" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand px-4 font-semibold text-white">
                  Add your first item
                </Link>
              </EmptyState>
            ) : (
              <div className="grid gap-7 lg:grid-cols-2 lg:items-start lg:gap-8">
                {cookFirst && cookFirst.length > 0 && (
                  <section>
                    <SectionTitle
                      action={
                        <Link to="/cook-first" className="text-sm font-semibold text-brand">
                          Open Cook First
                        </Link>
                      }
                    >
                      Needs attention
                    </SectionTitle>
                    {/* Phones show the top three; wide screens have room for all of them. */}
                    <div className="lg:hidden">
                      <FoodList items={cookFirst.slice(0, 3)} />
                      {cookFirst.length > 3 && (
                        <p className="mt-2 text-sm text-muted">+{cookFirst.length - 3} more in Cook First</p>
                      )}
                    </div>
                    <div className="hidden lg:block">
                      <FoodList items={cookFirst} />
                    </div>
                  </section>
                )}

                <section className={cookFirst && cookFirst.length > 0 ? '' : 'lg:col-span-2'}>
                  <SectionTitle>All food ({inventory.items.length})</SectionTitle>
                  <p className="-mt-2 mb-3 text-sm text-muted">{screenCopy.dashboard.sortedHint}</p>
                  <FoodList items={inventory.items} columns={cookFirst && cookFirst.length > 0 ? 1 : 2} />
                </section>
              </div>
            )}
            <EstimateNote />
          </>
        )}
      </PageBody>
    </>
  );
}
