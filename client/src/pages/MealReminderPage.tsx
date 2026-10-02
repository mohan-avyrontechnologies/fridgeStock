import { MEAL_TYPES, type MealContent, type MealReminderView, type MealType } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { PageBody, PageHeader } from '../components/AppShell';
import { Button, EmptyState, Spinner, Card } from '../components/ui';
import { mealPageCopy as copy, recipeCopy } from '../copy';

/** The title the "Cooked it" form starts from: the planned meal's or the recipe's. */
const cookedFrom = (content: MealContent) =>
  content.source === 'plan' ? content.title : content.source === 'recipe' ? content.recipe.title : null;

/**
 * What today's cooking reminder for one meal showed: the planned meal, the recipe with its steps, or the
 * Cook First items to use up. Opened by "Show recipe" on the reminder. Reading only: nothing here changes the
 * Cook First order.
 */
export function MealReminderPage() {
  const { meal } = useParams();
  const navigate = useNavigate();
  const valid = (MEAL_TYPES as readonly string[]).includes(meal ?? '');
  const [view, setView] = useState<MealReminderView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let current = true;
    api.mealReminder(meal as MealType).then(
      (loaded) => current && setView(loaded),
      () => current && setMissing(true),
    );
    return () => {
      current = false;
    };
  }, [meal, valid]);

  if (!valid) return <Navigate to="/" replace />;
  const label = copy.mealNames[meal as MealType];

  return (
    <>
      <PageHeader title={copy.title(label)} />
      <PageBody narrow>
        {!view && !missing && <Spinner />}
        {missing && (
          <EmptyState title={copy.none}>
            <Link to="/cook-first" className="text-brand underline-offset-2 hover:underline">
              {copy.openCookFirst}
            </Link>
          </EmptyState>
        )}
        {view && (
          <Card as="article" className="space-y-3 p-4">
            {view.content.source === 'plan' && (
              <>
                <p className="text-sm font-medium text-muted">{copy.planned}</p>
                <h2 className="text-lg font-semibold">{view.content.title}</h2>
                {view.content.foods.length > 0 && (
                  <p className="text-sm">
                    <span className="font-medium">{recipeCopy.uses}: </span>
                    {view.content.foods.map((food, i) => (
                      <span key={food.id}>
                        {i > 0 && ', '}
                        <Link to={`/food/${food.id}`} className="text-brand underline-offset-2 hover:underline">
                          {food.name}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
              </>
            )}
            {view.content.source === 'recipe' && (
              <>
                <h2 className="text-lg font-semibold">{view.content.recipe.title}</h2>
                <p className="text-sm text-muted">{recipeCopy.minutes(view.content.recipe.minutes)}</p>
                <p className="text-sm">
                  <span className="font-medium">{recipeCopy.uses}: </span>
                  {view.content.recipe.uses.map((food, i) => (
                    <span key={food.id}>
                      {i > 0 && ', '}
                      <Link to={`/food/${food.id}`} className="text-brand underline-offset-2 hover:underline">
                        {food.name}
                      </Link>
                    </span>
                  ))}
                </p>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {view.content.recipe.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="text-sm text-muted">{copy.aiNote}</p>
              </>
            )}
            {view.content.source === 'items' && (
              <>
                <p className="text-sm font-medium text-muted">{copy.noRecipe}</p>
                <h2 className="text-lg font-semibold">{copy.itemsTitle}</h2>
                <ul className="space-y-1">
                  {view.content.items.map((item) => (
                    <li key={item.id}>
                      <Link to={`/food/${item.id}`} className="text-brand underline-offset-2 hover:underline">
                        {item.name}
                      </Link>
                      <span className="text-sm text-muted"> · {copy.daysLeft(item.remainingDays)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Button
              className="w-full"
              onClick={() => {
                const from = cookedFrom(view.content);
                navigate(from ? `/add?leftover=1&from=${encodeURIComponent(from)}` : '/add?leftover=1');
              }}
            >
              {copy.cooked}
            </Button>
          </Card>
        )}
      </PageBody>
    </>
  );
}
