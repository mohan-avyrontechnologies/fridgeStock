import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { RecipeIdeas } from '../components/RecipeIdeas';
import { EstimateNote } from '../components/Urgency';
import { Button, EmptyState, LoadError, SkeletonList } from '../components/ui';
import { emptyCopy, homeCopy, screenCopy } from '../copy';
import { useNavigate } from 'react-router';
import { useFoodStore } from '../stores/foodStore';

export function CookFirstPage() {
  const cookFirst = useFoodStore((s) => s.cookFirst);
  const error = useFoodStore((s) => s.error);
  const refresh = useFoodStore((s) => s.refresh);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Cook First" subtitle={screenCopy.cookFirst.subtitle} />
      <PageBody>
        {!cookFirst && !error && <SkeletonList />}
        {error && !cookFirst && (
          <LoadError title={screenCopy.cookFirst.loadError} detail={error} onRetry={() => void refresh()} />
        )}
        {cookFirst && cookFirst.length === 0 && (
          <EmptyState
            title={emptyCopy.cookFirst.title}
            action={
              <>
                <Button variant="secondary" onClick={() => navigate('/plan')}>
                  {homeCopy.planMeal}
                </Button>
                <Button onClick={() => navigate('/add')}>{homeCopy.addFood}</Button>
              </>
            }
          >
            {emptyCopy.cookFirst.body}
          </EmptyState>
        )}
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
