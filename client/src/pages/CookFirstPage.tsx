import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { RecipeIdeas } from '../components/RecipeIdeas';
import { EstimateNote } from '../components/Urgency';
import { EmptyState, Spinner } from '../components/ui';
import { screenCopy } from '../copy';
import { useFoodStore } from '../stores/foodStore';

export function CookFirstPage() {
  const cookFirst = useFoodStore((s) => s.cookFirst);
  const error = useFoodStore((s) => s.error);

  return (
    <>
      <PageHeader title="Cook First" subtitle={screenCopy.cookFirst.subtitle} />
      <PageBody>
        {!cookFirst && !error && <Spinner />}
        {error && !cookFirst && <EmptyState title={screenCopy.cookFirst.loadError}>{error}</EmptyState>}
        {cookFirst && cookFirst.length === 0 && <EmptyState title={screenCopy.cookFirst.empty} />}
        {cookFirst && cookFirst.length > 0 && (
          <>
            <p className="text-sm text-muted">{screenCopy.cookFirst.intro(cookFirst.length)}</p>
            <FoodList items={cookFirst} columns={2} />
            <RecipeIdeas />
          </>
        )}
        <EstimateNote />
      </PageBody>
    </>
  );
}
