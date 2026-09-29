import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { EstimateNote } from '../components/Urgency';
import { EmptyState, Spinner } from '../components/ui';
import { useFoodStore } from '../stores/foodStore';

export function CookFirstPage() {
  const cookFirst = useFoodStore((s) => s.cookFirst);
  const error = useFoodStore((s) => s.error);
  const total = useFoodStore((s) => s.inventory?.items.length ?? 0);

  return (
    <>
      <PageHeader title="Cook First" subtitle="What to use first, soonest expected expiry at the top" />
      <PageBody>
        {!cookFirst && !error && <Spinner />}
        {error && !cookFirst && <EmptyState title="Couldn’t load Cook First">{error}</EmptyState>}
        {cookFirst && cookFirst.length === 0 && (
          <EmptyState title="Nothing needs attention right now">
            {total > 0
              ? `None of your ${total} items are within 3 days of their expected expiry.`
              : 'Add food to see what to cook first.'}
          </EmptyState>
        )}
        {cookFirst && cookFirst.length > 0 && (
          <>
            <p className="text-sm text-muted">
              {cookFirst.length} {cookFirst.length === 1 ? 'item is' : 'items are'} at or near expected expiry. Tap
              “Update” once you’ve cooked with something.
            </p>
            <FoodList items={cookFirst} columns={2} />
          </>
        )}
        <EstimateNote long />
      </PageBody>
    </>
  );
}
