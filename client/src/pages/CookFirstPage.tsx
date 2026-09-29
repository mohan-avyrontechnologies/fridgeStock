import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { EstimateNote } from '../components/Urgency';
import { EmptyState, Spinner } from '../components/ui';
import { screenCopy } from '../copy';
import { useFoodStore } from '../stores/foodStore';

export function CookFirstPage() {
  const cookFirst = useFoodStore((s) => s.cookFirst);
  const error = useFoodStore((s) => s.error);
  const total = useFoodStore((s) => s.inventory?.items.length ?? 0);

  return (
    <>
      <PageHeader title="Cook First" subtitle={screenCopy.cookFirst.subtitle} />
      <PageBody>
        {!cookFirst && !error && <Spinner />}
        {error && !cookFirst && <EmptyState title="Couldn’t load Cook First">{error}</EmptyState>}
        {cookFirst && cookFirst.length === 0 && (
          <EmptyState title={screenCopy.cookFirst.emptyTitle}>{screenCopy.cookFirst.emptyBody(total)}</EmptyState>
        )}
        {cookFirst && cookFirst.length > 0 && (
          <>
            <p className="text-sm text-muted">{screenCopy.cookFirst.intro(cookFirst.length)}</p>
            <FoodList items={cookFirst} columns={2} />
          </>
        )}
        <EstimateNote />
      </PageBody>
    </>
  );
}
