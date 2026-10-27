import { PageBody, PageHeader } from '../components/AppShell';
import { FoodList } from '../components/FoodCard';
import { RecipeIdeas } from '../components/RecipeIdeas';
import { EstimateNote } from '../components/Urgency';
import { Button, EmptyState, LoadError, SkeletonList } from '../components/ui';
import { emptyCopy, homeCopy, screenCopy } from '../copy';
import { useNavigate } from 'react-router';
import { useFoodStore } from '../stores/foodStore';

export function FridgeStockPage() {
  const fridgeStock = useFoodStore((s) => s.fridgeStock);
  const error = useFoodStore((s) => s.error);
  const refresh = useFoodStore((s) => s.refresh);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="FridgeStock" subtitle={screenCopy.fridgeStock.subtitle} />
      <PageBody>
        {!fridgeStock && !error && <SkeletonList />}
        {error && !fridgeStock && (
          <LoadError title={screenCopy.fridgeStock.loadError} detail={error} onRetry={() => void refresh()} />
        )}
        {fridgeStock && fridgeStock.length === 0 && (
          <EmptyState
            title={emptyCopy.fridgeStock.title}
            action={
              <>
                <Button variant="secondary" onClick={() => navigate('/plan')}>
                  {homeCopy.planMeal}
                </Button>
                <Button onClick={() => navigate('/add')}>{homeCopy.addFood}</Button>
              </>
            }
          >
            {emptyCopy.fridgeStock.body}
          </EmptyState>
        )}
        {fridgeStock && fridgeStock.length > 0 && (
          <>
            <p className="text-sm text-muted">{screenCopy.fridgeStock.intro(fridgeStock.length)}</p>
            <FoodList items={fridgeStock} columns={2} />
            <RecipeIdeas />
          </>
        )}
        <EstimateNote />
      </PageBody>
    </>
  );
}
